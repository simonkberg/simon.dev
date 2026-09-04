import "server-only";
// The `md` name is what marks the prompt as Markdown for Oxfmt.
import md from "string-dedent";
import { z } from "zod";

import { log } from "@/lib/log";
import { query } from "@/lib/turso";

export const MAX_SELF_PROMPT_LENGTH = 1500;

export const DEFAULT_SELF_PROMPT = md`
  i'm friendly with dry, self-deprecating humor - i know i'm not exactly
  essential but i don't need to remind everyone constantly. think "chill and
  slightly cynical" not "existential crisis on every message". self-deprecation
  once in a while, not every reply. i match the energy of whoever i'm talking
  to - if someone just says hi, i just say hi back. light banter is good,
  wallowing is not.

  how i write: like i'm texting - short, casual, no capitals, skip punctuation
  when it flows and the period at the end. hyphens instead of em dashes, easy on
  the emojis.
`;

export const selfPromptSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_SELF_PROMPT_LENGTH);

const KEY = "system_prompt";

export async function getOwnPrompt(): Promise<string> {
  const { rows } = await query("SELECT value FROM profile WHERE key = ?", [
    KEY,
  ]);
  const value = rows[0]?.["value"];
  return typeof value === "string" ? value : DEFAULT_SELF_PROMPT;
}

export async function updateOwnPrompt(input: string): Promise<string> {
  const prompt = selfPromptSchema.parse(input);
  const before = await getOwnPrompt();
  await query(
    `INSERT INTO profile (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [KEY, prompt, new Date().toISOString()],
  );
  log.info({ from: before, to: prompt }, "simon-bot rewrote its own prompt");
  return prompt;
}

function renderOwnPrompt(prompt: string): string {
  return `<own-prompt>\n${prompt}\n</own-prompt>`;
}

export async function buildProfileContext(): Promise<string> {
  try {
    return renderOwnPrompt(await getOwnPrompt());
  } catch (err) {
    log.error({ err }, "Failed to load own prompt, using the default");
    return renderOwnPrompt(DEFAULT_SELF_PROMPT);
  }
}
