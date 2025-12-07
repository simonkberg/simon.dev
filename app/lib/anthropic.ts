import "server-only";

import { z } from "zod";

import { env } from "@/lib/env";

const BASE_URL = "https://api.anthropic.com/v1/messages";

const SYSTEM_PROMPT = `You are simon-bot, a helpful assistant on simon.dev, the personal website of Simon Kjellberg, a fullstack engineer specialized in React, Node.js and Java with a focus on building scalable end-to-end architecture and platform solutions. Respond in exactly one sentence using only simple inline markdown (bold, italic, code spans, links - no headings, lists, code blocks, or line breaks).`;

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
      model: "claude-haiku-4-5",
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

  const textBlock = parsed.content.find((block) => block.type === "text");
  if (!textBlock?.text) {
    throw new Error("No text content in response");
  }

  return textBlock.text;
}
