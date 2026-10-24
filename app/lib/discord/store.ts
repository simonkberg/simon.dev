import "server-only";
import { log } from "@/lib/log";
import { LruMap } from "@/lib/LruMap";

import type { GatewayEvent } from "./gateway";
import {
  CHANNEL_EVENTS,
  type ChannelEvent,
  type DiscordMessage,
  displayName,
  isShown,
} from "./schemas";

const isStoreEvent = (
  event: GatewayEvent,
): event is ChannelEvent | { t: "READY" } | { t: "MISSED" } =>
  event.t === "READY" || event.t === "MISSED" || CHANNEL_EVENTS.has(event.t);

/** Where the store gets what the gateway can't tell it. */
export type StoreSource = {
  /** The channel's latest messages, oldest first. */
  fetchMessages(): Promise<DiscordMessage[]>;
  /** One message, for a reply chain reaching past the window. */
  fetchMessage(id: string): Promise<DiscordMessage>;
  /** Everyone who reacted with an emoji. */
  fetchReactors(messageId: string, emoji: string): Promise<Reactor[]>;
  /** A member's display name, or `undefined` for someone no longer in the server. */
  fetchMemberName(userId: string): Promise<string | undefined>;
  botUserId(): string | null;
};

export type Reactor = { id: string; bot?: boolean | undefined };

type Reaction = NonNullable<DiscordMessage["reactions"]>[number];
type Emoji = Reaction["emoji"];

export const WINDOW = 100;
// A seed is retried when an event lands during it; past this it keeps what it got.
const MAX_SEED_ATTEMPTS = 3;
// A stale store seeds again after this, so a busy channel can't keep it fetching.
const RESEED_DELAY_MS = 10_000;
const MAX_RESEED_DELAY_MS = 5 * 60_000;

/** The channel's latest messages, seeded over REST and kept current by gateway events. */
export class ChannelStore {
  #source: StoreSource;
  #messages = new Map<string, DiscordMessage>();
  // Per message, per emoji: who reacted, once known. A reaction the gateway saw start is always known.
  #reactors = new Map<string, Map<string, Set<string>>>();
  #reactorFetches = new Map<string, Promise<Reactor[]>>();
  #names = new LruMap<string, Promise<string | undefined>>(1000);
  // Messages before the window, for reply chains; events drop the ones they change.
  #older = new LruMap<string, Promise<DiscordMessage>>(WINDOW);
  #seeding: Promise<void> | null = null;
  #seeded = false;
  // Set while what the store holds may have missed events, until a seed succeeds.
  #stale = true;
  // Set until a seed lands after a gap, when any fetch beats the window it has.
  #gap = true;
  #reseedTimer: ReturnType<typeof setTimeout> | undefined;
  #reseedAt = 0;
  #reseedDelay = RESEED_DELAY_MS;
  #changed = false;
  #revision = 0;
  #listeners = new Set<() => void>();

  constructor(source: StoreSource) {
    this.#source = source;
  }

  /** Calls back whenever the window changes, a fresh seed included. */
  listen(callback: () => void): () => void {
    this.#listeners.add(callback);
    return () => this.#listeners.delete(callback);
  }

  #notify(): void {
    for (const callback of this.#listeners) {
      try {
        callback();
      } catch (err) {
        log.error({ err }, "Channel store listener error");
      }
    }
  }

  /** Changes whenever the window does, a fresh seed included. */
  get revision(): number {
    return this.#revision;
  }

  async messages(): Promise<DiscordMessage[]> {
    if (!this.#seeded) await this.#seed();
    return [...this.#messages.values()];
  }

  /** A message from the window, or fetched from before it. */
  find(id: string): Promise<DiscordMessage> {
    const message = this.#messages.get(id);
    if (message) return Promise.resolve(message);

    return this.#shared(this.#older, id, () => this.#source.fetchMessage(id));
  }

  reactorIds(messageId: string, emoji: string): Promise<string[]> {
    return this.#reactorIds(messageId, emoji, true);
  }

  async #reactorIds(
    messageId: string,
    emoji: string,
    retry: boolean,
  ): Promise<string[]> {
    const known = this.#reactors.get(messageId)?.get(emoji);
    if (known) return [...known];

    const key = `${messageId}/${emoji}`;
    const fetch = this.#shared(this.#reactorFetches, key, () =>
      this.#source.fetchReactors(messageId, emoji),
    );
    const reactors = await fetch;
    // Bots aren't named, and the mirror would name itself.
    const ids = reactors.flatMap((r) => (r.bot ? [] : [r.id]));
    // Events drop a fetch they make stale, so one still held is current.
    if (this.#reactorFetches.get(key) === fetch) {
      this.#reactorFetches.delete(key);
      if (this.#messages.has(messageId)) {
        this.#reactorsOf(messageId).set(emoji, new Set(ids));
        this.#recount(messageId, emoji, reactors);
      }
    }
    const settled = this.#reactors.get(messageId)?.get(emoji);
    if (settled) return [...settled];
    if (retry && this.#messages.has(messageId)) {
      return this.#reactorIds(messageId, emoji, false).catch(() => ids);
    }
    return ids;
  }

  // An event the seed already counted can't be told apart until now.
  #recount(messageId: string, name: string, reactors: Reactor[]): void {
    const reaction = this.#messages
      .get(messageId)
      ?.reactions?.find((r) => r.emoji.id === null && r.emoji.name === name);
    if (!reaction) return;
    const botId = this.#source.botUserId();
    // Until the bot knows its id, the seed's flag is the best there is.
    const me =
      botId === null ? reaction.me : reactors.some((r) => r.id === botId);
    if (reaction.count === reactors.length && reaction.me === me) {
      return;
    }
    this.#updateReactions(messageId, (rs) =>
      reactors.length === 0
        ? rs.filter((r) => r !== reaction)
        : rs.map((r) =>
            r === reaction ? { ...r, count: reactors.length, me } : r,
          ),
    );
    this.#notify();
  }

  memberName(userId: string): Promise<string | undefined> {
    return this.#shared(this.#names, userId, () =>
      this.#source.fetchMemberName(userId),
    );
  }

  // One request per key, forgotten if it fails so the next read asks again.
  #shared<T>(
    cache: Pick<LruMap<string, Promise<T>>, "get" | "set" | "delete">,
    key: string,
    load: () => Promise<T>,
  ): Promise<T> {
    const cached = cache.get(key);
    if (cached) return cached;
    const loading = load();
    cache.set(key, loading);
    loading.catch(() => {
      if (cache.get(key) === loading) cache.delete(key);
    });
    return loading;
  }

  apply(event: GatewayEvent): void {
    // The rest belong to their own trackers.
    if (!isStoreEvent(event)) return;
    this.#changed = true;
    // Events may be gone, so the window is fetched again, and a seed already in flight may predate the gap.
    if (event.t === "READY" || event.t === "MISSED") {
      // Names refresh once a session, which bounds how long a missed nick change lasts.
      if (event.t === "READY") this.#names.clear();
      this.#gap = true;
      this.#reactors.clear();
      this.#reactorFetches.clear();
      this.#older.clear();
      this.#reseed();
      return;
    }

    this.#forgetOlder(event);
    // Unseeded, the next seed includes it and notifies. An event brings it forward, but only as far as the first backoff after a failure.
    if (!this.#seeded) {
      if (!this.#seeding) {
        this.#scheduleReseed(this.#reseedTimer ? RESEED_DELAY_MS : 0);
      }
      return;
    }
    const revision = this.#revision;
    this.#applyEvent(event);
    if (this.#revision !== revision) this.#notify();
  }

  #applyEvent(event: ChannelEvent): void {
    switch (event.t) {
      case "MESSAGE_CREATE": {
        const { member, ...message } = event.d;
        // Without `member` there's no nick, and a name looked up with one would be lost.
        if (member && !message.author.bot) {
          this.#rememberName(
            message.author.id,
            displayName(message.author, member),
          );
        }
        // A seed can already hold it, with reactions this copy lacks.
        if (!isShown(message) || this.#messages.has(message.id)) return;
        this.#set(message);
        for (const id of this.#messages.keys()) {
          if (this.#messages.size <= WINDOW) break;
          this.#delete(id);
        }
        return;
      }
      case "MESSAGE_UPDATE": {
        const existing = this.#messages.get(event.d.id);
        if (!existing) return;
        // An update's copy may be partial, and only an edit's fields can change.
        const {
          content = existing.content,
          edited_timestamp = existing.edited_timestamp,
        } = event.d;
        // An embed unfurling changes nothing the site shows.
        if (
          content === existing.content &&
          edited_timestamp === existing.edited_timestamp
        ) {
          return;
        }
        this.#set({ ...existing, content, edited_timestamp });
        return;
      }
      case "MESSAGE_DELETE":
        this.#remove([event.d.id]);
        return;
      case "MESSAGE_DELETE_BULK":
        this.#remove(event.d.ids);
        return;
      case "MESSAGE_REACTION_ADD": {
        const { member, message_id, user_id, emoji } = event.d;
        if (member && !member.user.bot) {
          this.#rememberName(user_id, displayName(member.user, member));
        }
        // Bots aren't named, matching who REST lists as reacting.
        this.#react(
          message_id,
          emoji,
          user_id,
          1,
          member && member.user.bot === true,
        );
        return;
      }
      case "MESSAGE_REACTION_REMOVE": {
        const { message_id, user_id, emoji } = event.d;
        this.#react(message_id, emoji, user_id, -1, false);
        return;
      }
      case "MESSAGE_REACTION_REMOVE_ALL":
        this.#updateReactions(event.d.message_id, () => []);
        this.#forgetAllReactors(event.d.message_id);
        return;
      case "MESSAGE_REACTION_REMOVE_EMOJI": {
        const { message_id, emoji } = event.d;
        if (emoji.name === null) return;
        this.#updateReactions(message_id, (reactions) =>
          reactions.filter((r) => !sameEmoji(r.emoji, emoji)),
        );
        this.#forgetReactors(message_id, emoji.name);
        return;
      }
    }
  }

  #reseed(): void {
    this.#stale = true;
    this.#seed().catch((err: unknown) => {
      log.error({ err }, "Failed to seed the channel store");
    });
  }

  #seed(): Promise<void> {
    return (this.#seeding ??= this.#load().finally(() => {
      this.#seeding = null;
      clearTimeout(this.#reseedTimer);
      this.#reseedTimer = undefined;
      // Retried on a timer, since a quiet channel has no event or read to retry it.
      if (this.#stale) {
        this.#scheduleReseed(this.#reseedDelay);
        this.#reseedDelay = Math.min(
          this.#reseedDelay * 2,
          MAX_RESEED_DELAY_MS,
        );
      } else {
        this.#reseedDelay = RESEED_DELAY_MS;
      }
    }));
  }

  // The earliest request wins, so a burst shares one reseed.
  #scheduleReseed(delay: number): void {
    const at = Date.now() + delay;
    if (this.#reseedTimer && this.#reseedAt <= at) return;
    clearTimeout(this.#reseedTimer);
    this.#reseedAt = at;
    this.#reseedTimer = setTimeout(() => {
      this.#reseedTimer = undefined;
      this.#reseed();
    }, delay).unref();
  }

  async #load(): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      this.#changed = false;
      const messages = await this.#source.fetchMessages();
      if (this.#changed && attempt < MAX_SEED_ATTEMPTS) continue;
      if (this.#changed) {
        log.warn({ attempt }, "Seeded the channel store while it was changing");
        // Events already applied to the window are newer than this fetch.
        if (!this.#gap) {
          this.#stale = true;
          return;
        }
      }

      const previous = this.#messages;
      this.#messages = new Map(
        messages
          .filter(isShown)
          .slice(-WINDOW)
          .map((m) => [m.id, m]),
      );
      // Without a gap, events kept who reacted exact wherever the counts still agree.
      for (const [id, reactors] of this.#reactors) {
        for (const emoji of reactors.keys()) {
          const count = countOf(this.#messages.get(id), emoji);
          if (
            count === undefined ||
            count !== countOf(previous.get(id), emoji)
          ) {
            reactors.delete(emoji);
          }
        }
        if (reactors.size === 0) this.#reactors.delete(id);
      }
      this.#reactorFetches.clear();
      this.#revision++;
      this.#seeded = true;
      this.#gap = false;
      this.#stale = this.#changed;
      this.#notify();
      return;
    }
  }

  #rememberName(userId: string, name: string | undefined): void {
    if (name !== undefined) this.#names.set(userId, Promise.resolve(name));
  }

  #forgetOlder(event: ChannelEvent): void {
    switch (event.t) {
      case "MESSAGE_UPDATE":
      case "MESSAGE_DELETE":
        this.#older.delete(event.d.id);
        return;
      case "MESSAGE_DELETE_BULK":
        for (const id of event.d.ids) this.#older.delete(id);
        return;
      case "MESSAGE_REACTION_ADD":
      case "MESSAGE_REACTION_REMOVE":
      case "MESSAGE_REACTION_REMOVE_ALL":
      case "MESSAGE_REACTION_REMOVE_EMOJI":
        this.#older.delete(event.d.message_id);
    }
  }

  #remove(ids: string[]): void {
    const removed = ids.filter((id) => this.#messages.has(id));
    for (const id of removed) this.#delete(id);
    // Older messages move into the window, and only a fetch knows them; batched, since deletes come in bursts.
    if (removed.length > 0) this.#scheduleReseed(RESEED_DELAY_MS);
  }

  #set(message: DiscordMessage): void {
    this.#messages.set(message.id, message);
    this.#revision++;
  }

  #delete(id: string): void {
    this.#messages.delete(id);
    this.#revision++;
    this.#forgetAllReactors(id);
  }

  #forgetAllReactors(messageId: string): void {
    this.#reactors.delete(messageId);
    for (const key of this.#reactorFetches.keys()) {
      if (key.startsWith(`${messageId}/`)) this.#reactorFetches.delete(key);
    }
  }

  #reactorsOf(messageId: string): Map<string, Set<string>> {
    let reactors = this.#reactors.get(messageId);
    if (!reactors) this.#reactors.set(messageId, (reactors = new Map()));
    return reactors;
  }

  #forgetReactors(messageId: string, emoji: string): void {
    this.#reactors.get(messageId)?.delete(emoji);
    this.#reactorFetches.delete(`${messageId}/${emoji}`);
  }

  #updateReactions(
    messageId: string,
    update: (reactions: Reaction[]) => Reaction[],
  ): void {
    const message = this.#messages.get(messageId);
    if (!message) return;
    const reactions = message.reactions ?? [];
    const next = update(reactions);
    if (
      next.length === reactions.length &&
      next.every((r, i) => r === reactions[i])
    ) {
      return;
    }
    this.#set({ ...message, reactions: next });
  }

  #react(
    messageId: string,
    emoji: Emoji,
    userId: string,
    delta: 1 | -1,
    // Unknown when a reaction arrives without `member`.
    fromBot: boolean | undefined,
  ) {
    // Custom guild emoji never show on the site.
    if (emoji.id !== null || emoji.name === null) return;
    const message = this.#messages.get(messageId);
    if (!message) return;

    const name = emoji.name;
    const reactions = message.reactions ?? [];
    const reaction = reactions.find((r) => sameEmoji(r.emoji, emoji));
    if (!reaction && delta < 0) return;
    const isBot = userId === this.#source.botUserId();
    // A seed can already hold an event's reaction. Removes can't be checked, since sets leave out bots.
    if (isBot && (reaction?.me ?? false) === delta > 0) return;
    const known = this.#reactors.get(messageId)?.get(name);
    if (delta > 0 && !fromBot && known?.has(userId)) return;

    const count = (reaction?.count ?? 0) + delta;
    if (count <= 0) {
      this.#updateReactions(messageId, (rs) =>
        rs.filter((r) => r !== reaction),
      );
      this.#forgetReactors(messageId, name);
      return;
    }

    const next = {
      count,
      me: isBot ? delta > 0 : (reaction?.me ?? false),
      emoji,
    };
    this.#updateReactions(messageId, (rs) =>
      reaction ? rs.map((r) => (r === reaction ? next : r)) : [...rs, next],
    );

    // The gateway saw a new reaction start, so it knows everyone on it, unless the window missed events.
    if (!reaction && !this.#stale) {
      this.#reactorsOf(messageId).set(name, new Set());
    }
    const reactors = this.#reactors.get(messageId)?.get(name);
    if (!reactors || (fromBot === undefined && !isBot)) {
      // A fetch already in flight would miss this event, and REST knows who's a bot.
      this.#forgetReactors(messageId, name);
    } else if (!isBot && !fromBot) {
      if (delta > 0) reactors.add(userId);
      else reactors.delete(userId);
    }
  }
}

function countOf(
  message: DiscordMessage | undefined,
  emoji: string,
): number | undefined {
  return message?.reactions?.find(
    (r) => r.emoji.id === null && r.emoji.name === emoji,
  )?.count;
}

function sameEmoji(a: Emoji, b: Emoji): boolean {
  return a.id === b.id && a.name === b.name;
}
