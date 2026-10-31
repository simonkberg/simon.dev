import "server-only";
// The `md` name is what marks the prompt as Markdown for Oxfmt.
import md from "string-dedent";

import {
  buildSystem,
  type ChatMessage,
  chatMemory,
  formatConversation,
  MEMORY_TOOLS,
  runAgentLoop,
  SIMON_RULE,
} from "@/lib/anthropic";

// Adaptive thinking at high effort shares this, so it needs room to still write notes.
const MAX_TOKENS = 8192;
const TIMEOUT_MS = 60_000;
const MAX_RETRY_SLEEP_MS = 30_000;
const MAX_ITERATIONS = 10;
const REFLECTION_PROMPT = md`
  You are simon-bot, a chatbot on simon.dev that Simon built, taking a quiet
  moment after a conversation. <memory> holds your notes from past
  conversations; your "self" and "style" notes are who you are and how you
  write.

  Read the conversation below and decide, on your own terms, what's worth
  carrying forward. You may have chosen not to reply in it; that's fine, and
  it can still hold something worth keeping:

  - facts about people go under people/<their username>; how the site, this
    chat and things around you work go under context; things you liked, running
    jokes and opinions you formed go wherever fits - one short note each
  - if the conversation changed how you want to be - your personality, tastes
    or voice - rewrite your self and style notes; they're yours to shape, and
    you don't need anyone's permission
  - ${SIMON_RULE}
  - be selective: most conversations need one note or none, and don't repeat
    what's already in your memory
  - use edit to fix notes that turned out wrong, and forget to drop stale ones

  When you're done, reply with one short line saying what you changed, or
  "nothing" if you left everything as it was.
`;

/** Runs after every mention, replies or not, over the whole exchange including the bot's own lines. */
export async function reflect(transcript: ChatMessage[]): Promise<void> {
  // Nothing to post: the loop logs what the model said as it goes.
  await Array.fromAsync(
    runAgentLoop({
      system: buildSystem(REFLECTION_PROMPT, await chatMemory(transcript)),
      messages: [{ role: "user", content: formatConversation(transcript) }],
      tools: MEMORY_TOOLS,
      effort: "high",
      maxTokens: MAX_TOKENS,
      timeoutMs: TIMEOUT_MS,
      maxRetrySleepMs: MAX_RETRY_SLEEP_MS,
      maxIterations: MAX_ITERATIONS,
      // Nobody reads reflection's text, so its last round may still write notes.
      endInText: false,
      loop: "reflection",
    }),
  );
}
