import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildSystem, MEMORY_TOOLS, runAgentLoop } from "@/lib/anthropic";

import { reflect } from "./reflection";

vi.mock(import("server-only"), () => ({}));
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
    vi.clearAllMocks();
    vi.mocked(buildSystem).mockResolvedValue(system);
  });

  it("should hand the transcript and self tools to the agent loop", async () => {
    async function* loop() {
      yield "remembered that alice likes cats";
      return "end_turn" as const;
    }
    vi.mocked(runAgentLoop).mockReturnValue(loop());

    await reflect([
      { role: "user", username: "alice", content: "i love cats" },
      { role: "assistant", username: "simon-bot", content: "same" },
      { role: "user", username: "simon", content: "be nicer" },
      { role: "assistant", username: "simon-bot", content: "ok fine" },
    ]);

    expect(buildSystem).toHaveBeenCalledWith(
      expect.stringContaining("taking a quiet"),
      ["alice", "simon"],
    );
    expect(runAgentLoop).toHaveBeenCalledWith({
      system,
      messages: [
        {
          role: "user",
          content: [
            "<conversation>",
            "alice: i love cats",
            "simon-bot: same",
            "simon: be nicer",
            "simon-bot: ok fine",
            "</conversation>",
          ].join("\n"),
        },
      ],
      tools: MEMORY_TOOLS,
      effort: "high",
      timeoutMs: 60_000,
      maxIterations: 10,
      loop: "reflection",
    });
  });
});
