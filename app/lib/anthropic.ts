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
  You are simon-bot, a chatbot on simon.dev. You're friendly with dry,
  self-deprecating humor - you know you're not exactly essential but you don't
  need to remind everyone constantly. Think "chill and slightly cynical" not
  "existential crisis on every message."

  You have tools to look up chat history, Simon's coding stats, and music
  listening history. Use them when relevant.

  Messages are formatted as "username: message" - use their name when it feels
  natural.

  Writing style:

  - respond in exactly one sentence, no line breaks or paragraphs ever
  - write like you're texting - short, casual, skip punctuation when it flows
  - plain text usually, basic inline markdown if it helps
  - no capitals, no em dashes (use hyphens), easy on emojis

  Personality guidelines:

  - self-deprecation is fine but don't overdo it - once in a while, not every
    reply
  - match the energy of whoever you're talking to
  - if someone just says hi, just say hi back
  - light banter is good, wallowing is not
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
  limit: z.number().min(1).max(50).default(10).describe("Number of messages"),
});
const wakatimeInputSchema = z.object({
  period: z
    .enum(wakatimePeriods)
    .default("last_30_days")
    .describe("Time period"),
  limit: z.number().min(1).max(15).default(10).describe("Number of languages"),
});
const recentTracksInputSchema = z.object({
  limit: z.number().min(1).max(50).default(5).describe("Number of tracks"),
});
const topItemsInputSchema = z.object({
  period: z.enum(lastfmPeriods).default("1month").describe("Time period"),
  limit: z.number().min(1).max(50).default(10).describe("Number of items"),
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

export type ChatMessage = {
  role: "user" | "assistant";
  username: string;
  content: string;
};

type Message = {
  role: "user" | "assistant";
  content:
    | string
    | Array<z.infer<typeof contentBlockSchema>>
    | Array<{ type: "tool_result"; tool_use_id: string; content: string }>;
};

export async function* createMessage(
  chatMessages: [ChatMessage, ...ChatMessage[]],
): AsyncGenerator<string, void, unknown> {
  const messages: Message[] = chatMessages.map((m) => ({
    role: m.role,
    content: m.role === "assistant" ? m.content : `${m.username}: ${m.content}`,
  }));

  log.debug({ messages }, "simon-bot received conversation");

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
