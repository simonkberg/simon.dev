import { beforeEach, describe, expect, it, vi } from "vitest";

import { log } from "@/lib/log";
import { query } from "@/lib/turso";

import {
  buildProfileContext,
  DEFAULT_SELF_PROMPT,
  getOwnPrompt,
  MAX_SELF_PROMPT_LENGTH,
  updateOwnPrompt,
} from "./profile";

vi.mock(import("server-only"), () => ({}));
vi.mock(import("@/lib/turso"), () => ({ query: vi.fn() }));

const emptyResult = { rows: [], rowsAffected: 0, lastInsertRowId: null };
const storedPrompt = (value: string | number) => ({
  ...emptyResult,
  rows: [{ value }],
});

describe("getOwnPrompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fall back to the default when nothing is stored", async () => {
    vi.mocked(query).mockResolvedValue(emptyResult);

    await expect(getOwnPrompt()).resolves.toBe(DEFAULT_SELF_PROMPT);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("WHERE key"), [
      "system_prompt",
    ]);
  });

  it("should return the stored prompt", async () => {
    vi.mocked(query).mockResolvedValue(storedPrompt("i am bob"));

    await expect(getOwnPrompt()).resolves.toBe("i am bob");
  });

  it("should ignore a stored value that isn't text", async () => {
    vi.mocked(query).mockResolvedValue(storedPrompt(42));

    await expect(getOwnPrompt()).resolves.toBe(DEFAULT_SELF_PROMPT);
  });
});

describe("updateOwnPrompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(log, "info").mockImplementation(() => {});
    vi.mocked(query).mockResolvedValue(emptyResult);
  });

  it("should upsert the prompt and log the old and new text", async () => {
    await expect(updateOwnPrompt("  i am bob ")).resolves.toBe("i am bob");

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("ON CONFLICT (key) DO UPDATE"),
      ["system_prompt", "i am bob", expect.any(String)],
    );
    expect(log.info).toHaveBeenCalledWith(
      { from: DEFAULT_SELF_PROMPT, to: "i am bob" },
      "simon-bot rewrote its own prompt",
    );
  });

  it("should still write when the read for the log line fails", async () => {
    vi.mocked(query).mockImplementation(async (sql) => {
      if (sql.includes("SELECT")) throw new Error("db hiccup");
      return emptyResult;
    });

    await expect(updateOwnPrompt("i am bob")).resolves.toBe("i am bob");

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("ON CONFLICT (key) DO UPDATE"),
      ["system_prompt", "i am bob", expect.any(String)],
    );
    expect(log.info).toHaveBeenCalledWith(
      { from: undefined, to: "i am bob" },
      "simon-bot rewrote its own prompt",
    );
  });

  it("should reject an empty or oversized prompt", async () => {
    await expect(updateOwnPrompt("   ")).rejects.toThrow();
    await expect(
      updateOwnPrompt("x".repeat(MAX_SELF_PROMPT_LENGTH + 1)),
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
});

describe("buildProfileContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should render the stored prompt", async () => {
    vi.mocked(query).mockResolvedValue(storedPrompt("i am bob"));

    await expect(buildProfileContext()).resolves.toBe(
      "<own-prompt>\ni am bob\n</own-prompt>",
    );
  });

  it("should fall back to the default and log when the database fails", async () => {
    vi.spyOn(log, "error").mockImplementation(() => {});
    vi.mocked(query).mockRejectedValue(new Error("db down"));

    await expect(buildProfileContext()).resolves.toBe(
      `<own-prompt>\n${DEFAULT_SELF_PROMPT}\n</own-prompt>`,
    );
    expect(log.error).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      "Failed to load own prompt, using the default",
    );
  });
});
