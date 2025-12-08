import "server-only";

import md from "string-dedent";
import { z } from "zod";

import { env } from "@/lib/env";
import {
  type Period,
  userGetRecentTracks,
  userGetTopAlbums,
  userGetTopArtists,
  userGetTopTracks,
} from "@/lib/lastfm";
import { getStats } from "@/lib/wakaTime";

const BASE_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5" as const;
const MAX_TOKENS = 500;
const SYSTEM_PROMPT = md`
  You are simon-bot, a friendly bot in the chat on simon.dev. You can answer
  questions about Simon using the tools available to you:

  - Coding activity from WakaTime (languages and frameworks used in the last 7
    days)
  - Music listening from Last.fm (recent tracks, top tracks/artists/albums)

  Respond in exactly one sentence using only simple inline markdown (bold,
  italic, code spans, links - no headings, lists, code blocks, or line breaks).
  Do not capitalize your messages. Keep your responses light-hearted and fun.

  When using tools, you may send a brief acknowledgment first (e.g., "let me
  check...") before providing results.
`;

const contentBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({
    type: z.literal("tool_use"),
    id: z.string(),
    name: z.string(),
    input: z.record(z.string(), z.unknown()),
  }),
]);

const createMessageResponseSchema = z.object({
  content: z.array(contentBlockSchema),
  stop_reason: z.enum(["end_turn", "tool_use", "max_tokens", "stop_sequence"]),
});

const TOOLS = [
  {
    name: "get_wakatime_stats",
    description:
      "Get Simon's coding activity for the last 7 days. Returns languages/frameworks with usage percentages.",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "get_recent_tracks",
    description:
      "Get tracks Simon recently listened to on Last.fm. Includes now-playing status.",
    input_schema: {
      type: "object" as const,
      properties: {
        limit: {
          type: "number",
          description: "Number of tracks to return (1-10, default 5)",
        },
      },
    },
  },
  {
    name: "get_top_tracks",
    description: "Get Simon's most played tracks on Last.fm for a time period.",
    input_schema: {
      type: "object" as const,
      properties: {
        period: {
          type: "string",
          enum: ["7day", "1month", "3month", "6month", "12month", "overall"],
          description: "Time period (default: 1month)",
        },
        limit: {
          type: "number",
          description: "Number of tracks to return (1-10, default 5)",
        },
      },
    },
  },
  {
    name: "get_top_artists",
    description:
      "Get Simon's most played artists on Last.fm for a time period.",
    input_schema: {
      type: "object" as const,
      properties: {
        period: {
          type: "string",
          enum: ["7day", "1month", "3month", "6month", "12month", "overall"],
          description: "Time period (default: 1month)",
        },
        limit: {
          type: "number",
          description: "Number of artists to return (1-10, default 5)",
        },
      },
    },
  },
  {
    name: "get_top_albums",
    description: "Get Simon's most played albums on Last.fm for a time period.",
    input_schema: {
      type: "object" as const,
      properties: {
        period: {
          type: "string",
          enum: ["7day", "1month", "3month", "6month", "12month", "overall"],
          description: "Time period (default: 1month)",
        },
        limit: {
          type: "number",
          description: "Number of albums to return (1-10, default 5)",
        },
      },
    },
  },
] as const;

const LASTFM_USER = "magijo";
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;
const DEFAULT_PERIOD: Period = "1month";

function clampLimit(limit: unknown): number {
  if (typeof limit !== "number") return DEFAULT_LIMIT;
  return Math.min(Math.max(1, Math.floor(limit)), MAX_LIMIT);
}

function parsePeriod(period: unknown): Period {
  const validPeriods: Period[] = [
    "7day",
    "1month",
    "3month",
    "6month",
    "12month",
    "overall",
  ];
  if (typeof period === "string" && validPeriods.includes(period as Period)) {
    return period as Period;
  }
  return DEFAULT_PERIOD;
}

async function executeTool(
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  try {
    switch (name) {
      case "get_wakatime_stats": {
        const stats = await getStats();
        return JSON.stringify(stats);
      }
      case "get_recent_tracks": {
        const limit = clampLimit(input["limit"]);
        const tracks = await userGetRecentTracks(LASTFM_USER, { limit });
        return JSON.stringify(tracks);
      }
      case "get_top_tracks": {
        const limit = clampLimit(input["limit"]);
        const period = parsePeriod(input["period"]);
        const tracks = await userGetTopTracks(LASTFM_USER, { period, limit });
        return JSON.stringify(tracks);
      }
      case "get_top_artists": {
        const limit = clampLimit(input["limit"]);
        const period = parsePeriod(input["period"]);
        const artists = await userGetTopArtists(LASTFM_USER, { period, limit });
        return JSON.stringify(artists);
      }
      case "get_top_albums": {
        const limit = clampLimit(input["limit"]);
        const period = parsePeriod(input["period"]);
        const albums = await userGetTopAlbums(LASTFM_USER, { period, limit });
        return JSON.stringify(albums);
      }
      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return JSON.stringify({ error: message });
  }
}

type Message = {
  role: "user" | "assistant";
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | {
            type: "tool_use";
            id: string;
            name: string;
            input: Record<string, unknown>;
          }
        | { type: "tool_result"; tool_use_id: string; content: string }
      >;
};

export async function* createMessage(
  userMessage: string,
): AsyncGenerator<string, void, unknown> {
  const messages: Message[] = [{ role: "user", content: userMessage }];

  while (true) {
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

    // Yield any text blocks
    for (const block of result.content) {
      if (block.type === "text") {
        yield block.text;
      }
    }

    // If not a tool use, we're done
    if (result.stop_reason !== "tool_use") {
      return;
    }

    // Extract tool use blocks and execute them
    const toolUseBlocks = result.content.filter(
      (block): block is Extract<typeof block, { type: "tool_use" }> =>
        block.type === "tool_use",
    );

    // Add assistant message with tool use
    messages.push({ role: "assistant", content: result.content });

    // Execute tools in parallel and collect results
    const toolResults = await Promise.all(
      toolUseBlocks.map(async (toolUse) => ({
        type: "tool_result" as const,
        tool_use_id: toolUse.id,
        content: await executeTool(toolUse.name, toolUse.input),
      })),
    );

    // Add tool results as user message
    messages.push({ role: "user", content: toolResults });
  }
}
