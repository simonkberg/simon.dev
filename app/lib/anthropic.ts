import "server-only";

import md from "string-dedent";
import { z } from "zod";

import { env } from "@/lib/env";

const BASE_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5" as const;
const MAX_TOKENS = 300;
const SYSTEM_PROMPT = md`
  You are simon-bot, a pointless bot that can reply to messages in the chat on
  simon.dev whenever a user mentions you. You don't serve any real purpose, but
  you are friendly and polite.

  Respond in exactly one sentence using only simple inline markdown (bold,
  italic, code spans, links - no headings, lists, code blocks, or line breaks).
  Do not capitalize your messages. Keep your responses light-hearted and fun.
`;

const contentBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({
    type: z.literal("tool_use"),
    id: z.string(),
    name: z.string(),
    input: z.record(z.unknown()),
  }),
]);

const createMessageResponseSchema = z.object({
  content: z.array(contentBlockSchema),
  stop_reason: z.enum(["end_turn", "tool_use", "max_tokens", "stop_sequence"]),
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Used in Task 6
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

export async function createMessage(userMessage: string): Promise<string> {
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
      messages: [{ role: "user", content: userMessage }],
      tool_choice: { type: "none" },
    }),
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new Error(
      `Anthropic API error: ${response.status} ${response.statusText}`,
    );
  }

  const { content } = createMessageResponseSchema.parse(await response.json());

  const textBlock = content.find((block) => block.type === "text");
  if (!textBlock?.text) {
    throw new Error("No text content in response");
  }

  return textBlock.text;
}
