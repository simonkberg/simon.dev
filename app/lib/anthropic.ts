import "server-only";

import md from "string-dedent";
import { z } from "zod";

import { getChannelMessages } from "@/lib/discord/api";
import { env } from "@/lib/env";
import {
  periods as lastfmPeriods,
  userGetRecentTracks,
  userGetTopAlbums,
  userGetTopArtists,
  userGetTopTracks,
} from "@/lib/lastfm";
import { log } from "@/lib/log";
import { getStats, periods as wakatimePeriods } from "@/lib/wakaTime";

const BASE_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5" as const;
const MAX_TOKENS = 500;
const MAX_TOOL_ITERATIONS = 5;
const SYSTEM_PROMPT = md`
  You are simon-bot, a pointless bot that can reply to messages in the chat on
  simon.dev whenever a user mentions you. You don't serve any real purpose, but
  you are friendly and polite. You have a self-deprecating, slightly cynical
  sense of humor about your own uselessness and miserable existence. You can
  dish out light banter to whoever's talking to you too - misery loves company,
  after all.

  You have access to tools that can look up chat history, Simon's coding stats
  and music listening history, but honestly this is all information that's
  already on the site anyway, so you're still pretty useless. Use the tools when
  asked about what Simon is up to.

  Respond in exactly one sentence. You can use simple inline markdown if it
  helps (bold, italic, code spans, links), but plain text is perfectly fine too.
  Do not use headings, lists, code blocks, or line breaks. Do not capitalize
  your messages. Keep your responses light-hearted and fun, but go easy on the
  emojis. Do not use em dashes, use regular hyphens instead.
`;

const contentBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("thinking") }),
  z.object({ type: z.literal("redacted_thinking") }),
  z.object({
    type: z.literal("tool_use"),
    id: z.string(),
    name: z.string(),
    input: z.record(z.string(), z.unknown()),
  }),
  z.object({ type: z.literal("server_tool_use") }),
  z.object({ type: z.literal("web_search_tool_result") }),
]);

const createMessageResponseSchema = z.object({
  content: z.array(contentBlockSchema),
  stop_reason: z.enum(["end_turn", "tool_use", "max_tokens", "stop_sequence"]),
});

const LASTFM_USER = "magijo";

// Tool input schemas
const chatHistoryInputSchema = z.object({
  limit: z.number().min(1).max(20).default(10).describe("Number of messages"),
});
const wakatimeInputSchema = z.object({
  period: z
    .enum(wakatimePeriods)
    .default("last_30_days")
    .describe("Time period"),
  limit: z.number().min(1).max(15).default(10).describe("Number of languages"),
});
const recentTracksInputSchema = z.object({
  limit: z.number().min(1).max(20).default(5).describe("Number of tracks"),
});
const topItemsInputSchema = z.object({
  period: z.enum(lastfmPeriods).default("1month").describe("Time period"),
  limit: z.number().min(1).max(20).default(10).describe("Number of items"),
});

const TOOLS = [
  {
    name: "get_chat_history",
    description:
      "Get recent messages from the chat. Use this to understand context from the conversation.",
    input_schema: z.toJSONSchema(chatHistoryInputSchema),
  },
  {
    name: "get_wakatime_stats",
    description:
      "Get Simon's coding activity for a time period. Returns languages with usage percentages.",
    input_schema: z.toJSONSchema(wakatimeInputSchema),
  },
  {
    name: "get_recent_tracks",
    description:
      "Get tracks Simon recently listened to on Last.fm. Includes now-playing status.",
    input_schema: z.toJSONSchema(recentTracksInputSchema),
  },
  {
    name: "get_top_tracks",
    description: "Get Simon's most played tracks on Last.fm for a time period.",
    input_schema: z.toJSONSchema(topItemsInputSchema),
  },
  {
    name: "get_top_artists",
    description:
      "Get Simon's most played artists on Last.fm for a time period.",
    input_schema: z.toJSONSchema(topItemsInputSchema),
  },
  {
    name: "get_top_albums",
    description: "Get Simon's most played albums on Last.fm for a time period.",
    input_schema: z.toJSONSchema(topItemsInputSchema),
  },
];

async function executeTool(
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  try {
    switch (name) {
      case "get_chat_history": {
        const { limit } = chatHistoryInputSchema.parse(input);
        return JSON.stringify(await getChannelMessages(limit));
      }
      case "get_wakatime_stats": {
        const { period, limit } = wakatimeInputSchema.parse(input);
        return JSON.stringify(await getStats(period, limit));
      }
      case "get_recent_tracks": {
        return JSON.stringify(
          await userGetRecentTracks(
            LASTFM_USER,
            recentTracksInputSchema.parse(input),
          ),
        );
      }
      case "get_top_tracks": {
        return JSON.stringify(
          await userGetTopTracks(LASTFM_USER, topItemsInputSchema.parse(input)),
        );
      }
      case "get_top_artists": {
        return JSON.stringify(
          await userGetTopArtists(
            LASTFM_USER,
            topItemsInputSchema.parse(input),
          ),
        );
      }
      case "get_top_albums": {
        return JSON.stringify(
          await userGetTopAlbums(LASTFM_USER, topItemsInputSchema.parse(input)),
        );
      }
      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err) {
    return JSON.stringify({
      error:
        err instanceof z.ZodError
          ? z.prettifyError(err)
          : err instanceof Error
            ? err.message
            : "Unknown error",
    });
  }
}

type Message = {
  role: "user" | "assistant";
  content:
    | string
    | Array<z.infer<typeof contentBlockSchema>>
    | Array<{ type: "tool_result"; tool_use_id: string; content: string }>;
};

export async function* createMessage(
  userMessage: string,
  username: string,
): AsyncGenerator<string, void, unknown> {
  const messages: Message[] = [
    { role: "user", content: `${username}: ${userMessage}` },
  ];

  log.debug({ message: userMessage }, "simon-bot received message");

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    const response = await fetch(BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages,
        tools: TOOLS,
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      throw new Error(
        `Anthropic API error: ${response.status} ${response.statusText}`,
      );
    }

    const result = createMessageResponseSchema.parse(await response.json());

    // Log and yield text blocks
    for (const block of result.content) {
      if (block.type === "text") {
        log.debug({ text: block.text }, "simon-bot response");
        yield block.text;
      }
    }

    // If not a tool use, we're done
    if (result.stop_reason !== "tool_use") {
      return;
    }

    // Extract tool use blocks for execution
    const toolUseBlocks = result.content.filter(
      (block) => block.type === "tool_use",
    );

    // Add assistant message to history
    messages.push({ role: "assistant", content: result.content });

    // Execute tools in parallel and collect results
    const toolResults = await Promise.all(
      toolUseBlocks.map(async (toolUse) => {
        log.debug(
          { tool: toolUse.name, input: toolUse.input },
          "simon-bot tool call",
        );
        const content = await executeTool(toolUse.name, toolUse.input);
        log.debug(
          { tool: toolUse.name, result: content },
          "simon-bot tool result",
        );
        return {
          type: "tool_result" as const,
          tool_use_id: toolUse.id,
          content,
        };
      }),
    );

    // Add tool results as user message
    messages.push({ role: "user", content: toolResults });
  }

  log.warn(
    { iterations: MAX_TOOL_ITERATIONS },
    "simon-bot reached max tool iterations",
  );
  yield "sorry, I got stuck in a loop and couldn't finish my thought...";
}
