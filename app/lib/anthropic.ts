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

const createMessageResponseSchema = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
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
