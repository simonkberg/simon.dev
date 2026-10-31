import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildSystem,
  type ChatMessage,
  formatConversation,
  MEMORY_TOOLS,
  runAgentLoop,
} from "@/lib/anthropic";
import { chatCategories } from "@/lib/memory";

import { reflect } from "./reflection";

vi.mock(import("@/lib/anthropic"), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, runAgentLoop: vi.fn(), buildSystem: vi.fn() };
});

describe("reflect", () => {
  const system = [
    { type: "text" as const, text: "prompt" },
    { type: "text" as const, text: "<memory>\n</memory>" },
  ];

  beforeEach(() => {
    vi.mocked(buildSystem).mockResolvedValue(system);
  });

  it("should hand the transcript and self tools to the agent loop", async () => {
    async function* loop() {
      yield "remembered that alice likes cats";
      return { end: "end_turn" as const, text: "" };
    }
    vi.mocked(runAgentLoop).mockReturnValue(loop());

    const transcript: ChatMessage[] = [
      { role: "user", username: "alice", content: "i love cats" },
      { role: "assistant", username: "simon-bot", content: "same" },
      { role: "user", username: "simon", content: "be nicer" },
      { role: "assistant", username: "simon-bot", content: "ok fine" },
    ];

    await reflect(transcript);

    expect(buildSystem).toHaveBeenCalledWith(
      expect.stringContaining("taking a quiet"),
      chatCategories(["alice", "simon"]),
    );
    expect(runAgentLoop).toHaveBeenCalledWith({
      system,
      messages: [{ role: "user", content: formatConversation(transcript) }],
      tools: MEMORY_TOOLS,
      effort: "high",
      maxTokens: 8192,
      timeoutMs: 60_000,
      maxRetrySleepMs: 30_000,
      maxIterations: 10,
      endInText: false,
      loop: "reflection",
    });
  });
});
