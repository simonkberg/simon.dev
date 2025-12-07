import "server-only";

import md from "string-dedent";
import { z } from "zod";

import { env } from "@/lib/env";

const BASE_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5" as const;

const SYSTEM_PROMPT = md`
  You are simon-bot, a pointless bot that can reply to messages in the chat on
  simon.dev whenever a user mentions you. You don't serve any real purpose, but
  you are friendly and polite.

  Respond in exactly one sentence using only simple inline markdown (bold,
  italic, code spans, links - no headings, lists, code blocks, or line breaks).
  Do not capitalize you messages. Keep your responses light-hearted and fun.
`;

const textContentBlockSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

const otherContentBlockSchema = z.object({
  type: z.string(),
  text: z.string().optional(),
});

const contentBlockSchema = z.union([
  textContentBlockSchema,
  otherContentBlockSchema,
]);

const createMessageResponseSchema = z.object({
  id: z.string(),
  type: z.literal("message"),
  role: z.literal("assistant"),
  model: z.string(),
  content: z.array(contentBlockSchema),
  stop_reason: z.string().nullable(),
  stop_sequence: z.string().nullable(),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }),
});

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
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    }),
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new Error(
      `Anthropic API error: ${response.status} ${response.statusText}`,
    );
  }

  const json = await response.json();
  const parsed = createMessageResponseSchema.parse(json);

  const textBlock = parsed.content.find(
    (block): block is z.infer<typeof textContentBlockSchema> =>
      block.type === "text",
  );
  if (!textBlock) {
    throw new Error("No text content in response");
  }

  return textBlock.text;
}
