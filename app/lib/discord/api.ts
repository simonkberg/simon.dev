import "server-only";
import { createHash, randomUUID } from "node:crypto";

import { comparing, stringComparator } from "comparator.ts";
import { z } from "zod";

import { env } from "@/lib/env";
import { getGlobal } from "@/lib/global";
import { log } from "@/lib/log";
import { stringToColor } from "@/lib/stringToColor";

import type { Username } from "../session";
import { connect, getBotUserId, subscribe } from "./gateway";
import {
  type DiscordMessage,
  DiscordMessageSchema,
  displayName,
  GuildMemberSchema,
  parentId,
  sitePost,
} from "./schemas";
import { ChannelStore, type Reactor, WINDOW } from "./store";

const BASE_URL = "https://discord.com/api/v10";
const RATE_LIMIT_TIMEOUT_MS = 30_000;
const GATE_JITTER_MS = 250;
const MAX_RETRIES = 5;

const RateLimitResponseSchema = z.object({
  message: z.string(),
  retry_after: z.number(),
  global: z.boolean(),
});

const ErrorResponseSchema = z.object({ code: z.number() });

export class DiscordApiError extends Error {
  readonly code: number | undefined;

  constructor(message: string, code: number | undefined) {
    super(message);
    this.name = "DiscordApiError";
    this.code = code;
  }
}

type Method = "GET" | "POST" | "PUT" | "DELETE";

type Placeholders<Route extends string> =
  Route extends `${string}{${infer Name}}${infer Rest}`
    ? Name | Placeholders<Rest>
    : never;

// The one channel and guild this app talks to come from env.
type RouteParams<Route extends string> = Record<
  Exclude<Placeholders<Route>, "channel.id" | "guild.id">,
  string
>;

function fillRoute(route: string, params: Record<string, string>): string {
  const values = Object.entries({
    ...params,
    "channel.id": env.DISCORD_CHANNEL_ID,
    "guild.id": env.DISCORD_GUILD_ID,
  });
  return values.reduce(
    (path, [name, value]) =>
      path.replaceAll(`{${name}}`, encodeURIComponent(value)),
    route,
  );
}

// Bucket (or GLOBAL_GATE) → when requests may go again. Only a 429 sets a gate; a success
// leaves it to lapse, since clearing it could wipe a newer 429's gate on the same bucket.
function rateLimitUntil(): Map<string, number> {
  return getGlobal("discord-rate-limit", () => new Map<string, number>());
}
const GLOBAL_GATE = "global";

/** @internal Exported for testing gates */
export function _setRateLimitGate(
  method: Method,
  route: string,
  until: number,
): void {
  rateLimitUntil().set(bucketOf(method, route), until);
}

// Discord buckets by route and channel or guild, and those never vary here.
function bucketOf(method: Method, route: string): string {
  return `${method} ${route}`;
}

function gateUntil(bucket: string): number {
  const gates = rateLimitUntil();
  return Math.max(gates.get(bucket) ?? 0, gates.get(GLOBAL_GATE) ?? 0);
}

// Counts the most jitter a wait can add, so a 429 and the gate agree on whether to give up.
function exceedsWaitBudget(elapsedMs: number, waitMs: number): boolean {
  return elapsedMs + waitMs + GATE_JITTER_MS > RATE_LIMIT_TIMEOUT_MS;
}

function rateLimitExceeded(details: Record<string, unknown>): Error {
  log.error(details, "Discord rate limit exceeded max wait time");
  return new Error("Discord rate limit exceeded");
}

async function waitForGate(
  bucket: string,
  startTime: number,
  context: { endpoint: string; retries: number },
): Promise<void> {
  // Re-read after each sleep, since another 429 may have moved the gate.
  while (true) {
    const waitMs = gateUntil(bucket) - Date.now();
    if (waitMs <= 0) return;
    const elapsedMs = performance.now() - startTime;
    if (exceedsWaitBudget(elapsedMs, waitMs)) {
      throw rateLimitExceeded({ ...context, elapsedMs, waitMs });
    }
    // Jitter, so callers waiting on one gate don't all retry at once.
    const jitterMs = Math.random() * GATE_JITTER_MS;
    await new Promise((resolve) => setTimeout(resolve, waitMs + jitterMs));
  }
}

// An empty body reads as null, and so does a proxy's HTML error page; a success can't.
async function readBody(response: Response, endpoint: string) {
  const text = await response.text();
  try {
    return { json: text === "" ? null : (JSON.parse(text) as unknown), text };
  } catch {
    if (!response.ok) return { json: null, text };
    const { status } = response;
    log.error(
      { endpoint, status, body: text.slice(0, 200) },
      "Discord API body isn't JSON",
    );
    throw new DiscordApiError(
      `Discord API error: ${status} body isn't JSON`,
      undefined,
    );
  }
}

// Retry-After is either delta-seconds or an HTTP-date.
function retryAfterHeaderMs(value: string | null): number | undefined {
  const header = value?.trim() ?? "";
  if (/^\d+$/.test(header)) return Number(header) * 1000;
  // An HTTP-date starts with its weekday, which keeps Date.parse off forms like "-5".
  if (!/^[a-z]{3,9},/i.test(header)) return undefined;
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : date - Date.now();
}

function rateLimitOf(response: Response, json: unknown, retries: number) {
  const body = RateLimitResponseSchema.safeParse(json).data;
  const reportedMs = body
    ? body.retry_after * 1000
    : retryAfterHeaderMs(response.headers.get("retry-after"));
  // A delay of zero or less, or a date already past, would retry back to back.
  const retryAfterMs =
    reportedMs !== undefined && reportedMs > 0
      ? reportedMs
      : 1000 * 2 ** (retries - 1);
  const global =
    body?.global === true ||
    response.headers.get("x-ratelimit-global") === "true";
  return { retryAfterMs, global };
}

async function call<Route extends string, T extends z.ZodType>(
  method: Method,
  route: Route,
  params: RouteParams<Route>,
  schema: T,
  data?: Record<string, unknown>,
): Promise<z.infer<T>> {
  const endpoint = fillRoute(route, params);
  const url = new URL(BASE_URL + endpoint);
  if (method === "GET") {
    for (const [key, value] of Object.entries(data ?? {})) {
      url.searchParams.set(key, String(value));
    }
  }

  const bucket = bucketOf(method, route);
  const startTime = performance.now();
  let retries = 0;

  while (true) {
    await waitForGate(bucket, startTime, { endpoint, retries });

    const response = await fetch(url, {
      method,
      body: method === "GET" ? undefined : JSON.stringify(data),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
      },
      signal: AbortSignal.timeout(5000),
    });
    const { json, text } = await readBody(response, endpoint);

    if (response.status === 429) {
      retries++;
      const { retryAfterMs, global } = rateLimitOf(response, json, retries);
      const until = Date.now() + retryAfterMs;
      const gate = global ? GLOBAL_GATE : bucket;
      // The true deadline, so callers that can't wait fail fast rather than re-hit Discord.
      const gates = rateLimitUntil();
      gates.set(gate, Math.max(gates.get(gate) ?? 0, until));

      const details = { endpoint, retryAfterMs, global, retries };
      const elapsedMs = performance.now() - startTime;
      if (retries > MAX_RETRIES || exceedsWaitBudget(elapsedMs, retryAfterMs)) {
        throw rateLimitExceeded({ ...details, elapsedMs });
      }
      log.warn(details, "Discord rate limited, retrying");
      continue;
    }

    if (!response.ok) {
      const { status, statusText } = response;
      log.error(
        { endpoint, status, body: json ?? text.slice(0, 200) },
        "Discord API call failed",
      );
      throw new DiscordApiError(
        `Discord API error: ${status} ${statusText}`,
        ErrorResponseSchema.safeParse(json).data?.code,
      );
    }

    return schema.parse(json);
  }
}

const UserSchema = z.object({
  name: z.string(),
  color: z.templateLiteral([
    "hsl(",
    z.number(),
    " ",
    z.number(),
    "% ",
    z.number(),
    "%)",
  ]),
});

export type User = z.infer<typeof UserSchema>;

function toUser(name: string): User {
  return UserSchema.decode({ name, color: stringToColor(name) });
}

async function resolveMessageContent(
  msg: DiscordMessage,
): Promise<{ username: string; content: string }> {
  const posted = sitePost(msg);
  if (posted) return posted;
  const username =
    (await getStore().memberName(msg.author.id)) ??
    displayName(msg.author) ??
    msg.author.id;
  // A forward's own content is empty; what it forwards is in its snapshot.
  const content =
    msg.content || (msg.message_snapshots?.[0]?.message.content ?? "");
  return { username, content: content.trim() };
}

// Discord's "Unknown Member" and "Unknown User".
const GONE_CODES = new Set<number | undefined>([10007, 10013]);

async function getMemberName(userId: string): Promise<string | undefined> {
  try {
    const member = await call(
      "GET",
      "/guilds/{guild.id}/members/{user.id}",
      { "user.id": userId },
      GuildMemberSchema,
    );
    return displayName(member.user, member);
  } catch (err) {
    // Someone who left the server has no member; asking again won't change that.
    if (err instanceof DiscordApiError && GONE_CODES.has(err.code)) {
      return undefined;
    }
    throw err;
  }
}

function getMessage(id: string): Promise<DiscordMessage> {
  return call(
    "GET",
    "/channels/{channel.id}/messages/{message.id}",
    { "message.id": id },
    DiscordMessageSchema,
  );
}

const ReactionSchema = z.object({
  emoji: z.string(),
  count: z.number(),
  /** Who reacted, where known; the rest of `count` reacted on Discord. */
  users: z.array(z.string()),
  /** The visitor's own, set per request by the page; `users` then leaves them out. */
  mine: z.boolean().optional(),
});

export type Reaction = z.infer<typeof ReactionSchema>;

// The bot's own reaction mirrors the site's, which are counted from Turso instead.
function toReactions(msg: DiscordMessage): Reaction[] {
  const reactions: Reaction[] = [];
  for (const { count, me, emoji } of msg.reactions ?? []) {
    const discordCount = me ? count - 1 : count;
    if (emoji.id === null && emoji.name !== null && discordCount > 0) {
      reactions.push({ emoji: emoji.name, count: discordCount, users: [] });
    }
  }
  return reactions;
}

const ReactorsResponseSchema = z.array(
  z.object({ id: z.string(), bot: z.boolean().optional() }),
);

const REACTORS_PAGE = 100;

// Pages through everyone, since the store keeps the set as exact.
async function getReactors(messageId: string, emoji: string) {
  const reactors: Reactor[] = [];
  let after: string | undefined;
  for (;;) {
    const page = await call(
      "GET",
      "/channels/{channel.id}/messages/{message.id}/reactions/{emoji}",
      { "message.id": messageId, emoji },
      ReactorsResponseSchema,
      after ? { limit: REACTORS_PAGE, after } : { limit: REACTORS_PAGE },
    );
    reactors.push(...page);
    after = page.at(-1)?.id;
    if (page.length < REACTORS_PAGE || !after) return reactors;
  }
}

async function getRecentMessages(): Promise<DiscordMessage[]> {
  const messages = await call(
    "GET",
    "/channels/{channel.id}/messages",
    {},
    z.array(DiscordMessageSchema),
    { limit: WINDOW },
  );
  return messages.toReversed();
}

function getStore(): ChannelStore {
  return getGlobal("discord-store", () => {
    const store = new ChannelStore({
      fetchMessages: getRecentMessages,
      fetchMessage: getMessage,
      fetchReactors: getReactors,
      fetchMemberName: getMemberName,
      botUserId: getBotUserId,
    });
    subscribe((event) => store.apply(event)).catch((err: unknown) => {
      log.error({ err }, "Channel store failed to subscribe to the gateway");
    });
    return store;
  });
}

/** Changes whenever the channel's history may have. */
export function getChannelRevision(): number {
  return getStore().revision;
}

/** Calls back once the history may have changed; rejects if the gateway can't connect. */
export async function subscribeToChannel(
  callback: () => void,
): Promise<() => void> {
  const unlisten = getStore().listen(callback);
  try {
    await connect();
  } catch (err) {
    unlisten();
    throw err;
  }
  return unlisten;
}

async function withDiscordReactors(
  messageId: string,
  reactions: Reaction[],
): Promise<Reaction[]> {
  const store = getStore();
  return Promise.all(
    reactions.map(async (reaction) => {
      try {
        const ids = await store.reactorIds(messageId, reaction.emoji);
        const names = await Promise.allSettled(
          ids.map((id) => store.memberName(id)),
        );
        // A reactor who left the server, or whose name failed to load, stays in the count unnamed.
        return {
          ...reaction,
          users: names.flatMap((name) =>
            name.status === "fulfilled" && name.value !== undefined
              ? [name.value]
              : [],
          ),
        };
      } catch (err) {
        log.warn(
          { err, messageId, emoji: reaction.emoji },
          "Failed to load reactors",
        );
        return reaction;
      }
    }),
  );
}

const MessageSchema = z.object({
  id: z.string(),
  user: UserSchema,
  /** Raw Discord markdown, never HTML — render with `<ChatMarkdown>`, never `dangerouslySetInnerHTML`. */
  content: z.string(),
  edited: z.boolean(),
  timestamp: z.string().pipe(z.coerce.date()),
  reactions: z.array(ReactionSchema),
  get replies() {
    return z.array(MessageSchema);
  },
});

export type Message = z.infer<typeof MessageSchema>;

const messageIdComparator = comparing(
  (msg: Message) => msg.id,
  stringComparator,
);

export async function getChannelMessages(limit = WINDOW): Promise<Message[]> {
  const window = (await getStore().messages()).slice(-limit);
  const byParent = Map.groupBy(window, parentId);

  // Starts from the roots, so a reply whose parent isn't in the window is left out.
  async function toMessage(msg: DiscordMessage): Promise<Message> {
    const [{ username, content }, reactions, replies] = await Promise.all([
      resolveMessageContent(msg),
      withDiscordReactors(msg.id, toReactions(msg)),
      toMessages(byParent.get(msg.id)),
    ]);
    const message = MessageSchema.decode({
      id: msg.id,
      user: toUser(username),
      content,
      edited: msg.edited_timestamp !== null,
      timestamp: msg.timestamp,
      reactions,
      replies: [],
    });
    return { ...message, replies };
  }

  async function toMessages(msgs: DiscordMessage[] = []): Promise<Message[]> {
    const messages = await Promise.all(msgs.map(toMessage));
    return messages.sort(messageIdComparator);
  }

  return toMessages(byParent.get(undefined));
}

export type ChainMessage = {
  id: string;
  type: number;
  username: string;
  content: string;
  reactions: Reaction[];
};

const MAX_CHAIN_DEPTH = 50;

export async function getMessageChain(
  messageId: string,
): Promise<ChainMessage[]> {
  const chain: ChainMessage[] = [];
  const seen = new Set<string>();
  let currentId: string | undefined = messageId;

  while (currentId && chain.length < MAX_CHAIN_DEPTH) {
    // Cycle detection
    if (seen.has(currentId)) break;
    seen.add(currentId);

    const response = await getStore().find(currentId);

    const { username, content } = await resolveMessageContent(response);

    chain.unshift({
      id: response.id,
      type: response.type,
      username,
      content,
      reactions: toReactions(response),
    });

    currentId = parentId(response);
  }

  return chain;
}

const SearchMessageSchema = DiscordMessageSchema.extend({
  hit: z.boolean().optional(),
});

const SearchGuildMessagesResponseSchema = z.object({
  total_results: z.number(),
  messages: z.array(z.array(SearchMessageSchema)),
});

export type SearchMessage = {
  id: string;
  username: string;
  content: string;
  timestamp: string;
};

export type SearchHit = { hit: SearchMessage; context: SearchMessage[] };

export type SearchResult = { total_results: number; hits: SearchHit[] };

async function resolveSearchMessage(
  msg: z.infer<typeof SearchMessageSchema>,
): Promise<SearchMessage> {
  const { username, content } = await resolveMessageContent(msg);
  return { id: msg.id, username, content, timestamp: msg.timestamp };
}

export async function searchChannelMessages(params: {
  content: string;
  limit?: number;
  sort_by?: "timestamp" | "relevance";
  sort_order?: "asc" | "desc";
}): Promise<SearchResult> {
  const response = await call(
    "GET",
    "/guilds/{guild.id}/messages/search",
    {},
    SearchGuildMessagesResponseSchema,
    { channel_id: env.DISCORD_CHANNEL_ID, ...params },
  );

  const hits = await Promise.all(
    response.messages.map(async (group) => {
      const hitMsg = group.find((msg) => msg.hit === true);
      if (!hitMsg) {
        throw new Error("Discord search returned a message group with no hit");
      }

      const contextMsgs = group.filter((msg) => msg !== hitMsg);

      const [hit, ...context] = await Promise.all([
        resolveSearchMessage(hitMsg),
        ...contextMsgs.map(resolveSearchMessage),
      ]);

      return { hit, context };
    }),
  );

  return { total_results: response.total_results, hits };
}

const PostChannelMessageResponseSchema = z.object({ id: z.string() });

// Previews share one channel, so this tells an environment's site posts apart.
function postNonce(): string {
  return getGlobal("discord/post-nonce", () =>
    createHash("sha256")
      .update(process.env["RAILWAY_ENVIRONMENT_ID"] ?? randomUUID())
      .digest("base64url")
      .slice(0, 25),
  );
}

export function isOwnPost(message: DiscordMessage): boolean {
  return message.nonce === postNonce();
}

export async function postChannelMessage(
  text: string,
  username: Username,
  replyToMessageId?: string,
): Promise<string> {
  // Loaded on first post, so pages that only read chat don't bundle the emoji data.
  const { emojify } = await import("@/lib/shortcodes");
  const body = {
    content: `${username}: ${emojify(text)}`,
    nonce: postNonce(),
    // A reply to a message deleted meanwhile goes out as a plain message.
    message_reference: replyToMessageId
      ? { message_id: replyToMessageId, fail_if_not_exists: false }
      : undefined,
  };

  const response = await call(
    "POST",
    "/channels/{channel.id}/messages",
    {},
    PostChannelMessageResponseSchema,
    body,
  );

  return response.id;
}

/** Shows the bot typing in the channel for 10s, or until it posts. */
export async function sendTyping(): Promise<void> {
  await call("POST", "/channels/{channel.id}/typing", {}, z.null());
}

async function botReaction(method: Method, messageId: string, emoji: string) {
  await call(
    method,
    "/channels/{channel.id}/messages/{message.id}/reactions/{emoji}/@me",
    { "message.id": messageId, emoji },
    z.null(),
  );
}

export async function addBotReaction(messageId: string, emoji: string) {
  await botReaction("PUT", messageId, emoji);
}

export async function removeBotReaction(messageId: string, emoji: string) {
  await botReaction("DELETE", messageId, emoji);
}
