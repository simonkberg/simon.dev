import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildContextBlocks, runAgentLoop, TOOLS } from "@/lib/anthropic";
import { log } from "@/lib/log";

import { reflect } from "./reflection";

vi.mock(import("server-only"), () => ({}));
vi.mock(import("@/lib/anthropic"), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, runAgentLoop: vi.fn(), buildContextBlocks: vi.fn() };
});

describe("reflect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(log, "info").mockImplementation(() => {});
    vi.mocked(buildContextBlocks).mockResolvedValue([
      { type: "text", text: "<memory>\n</memory>" },
    ]);
  });

  it("should hand the transcript and self tools to the agent loop", async () => {
    async function* loop() {
      yield "remembered that alice likes cats";
    }
    vi.mocked(runAgentLoop).mockReturnValue(loop());

    await reflect(
      [
        { role: "user", username: "alice", content: "i love cats" },
        { role: "assistant", username: "simon-bot", content: "same" },
        { role: "user", username: "simon", content: "be nicer", owner: true },
      ],
      ["ok fine", "cats are great"],
    );

    expect(buildContextBlocks).toHaveBeenCalledWith(["alice", "simon"]);
    expect(runAgentLoop).toHaveBeenCalledWith({
      system: [
        {
          type: "text",
          text: expect.stringContaining("You are simon-bot"),
          cache_control: { type: "ephemeral" },
        },
        { type: "text", text: "<memory>\n</memory>" },
      ],
      messages: [
        {
          role: "user",
          content: [
            "<conversation>",
            "alice: i love cats",
            "simon-bot: same",
            "simon (owner): be nicer",
            "simon-bot: ok fine",
            "simon-bot: cats are great",
            "</conversation>",
          ].join("\n"),
        },
      ],
      tools: TOOLS.filter((tool) =>
        ["remember", "recall", "forget", "update_self"].includes(tool.name),
      ),
      effort: "high",
      timeoutMs: 60_000,
      label: "simon-bot reflection",
    });
    expect(log.info).toHaveBeenCalledWith(
      { text: "remembered that alice likes cats" },
      "simon-bot reflected",
    );
  });

  it("should not expose lookup tools to the reflection", async () => {
    async function* loop() {}
    vi.mocked(runAgentLoop).mockReturnValue(loop());

    await reflect([{ role: "user", username: "a", content: "hi" }], []);

    const { tools } = vi.mocked(runAgentLoop).mock.calls[0]?.[0] ?? {};
    expect(tools?.map((tool) => tool.name)).toEqual([
      "remember",
      "recall",
      "forget",
      "update_self",
    ]);
  });
});
