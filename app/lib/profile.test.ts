import { beforeEach, describe, expect, it, vi } from "vitest";

import { log } from "@/lib/log";
import { query } from "@/lib/turso";

import {
  buildProfileContext,
  DEFAULT_SELF_PROMPT,
  getProfile,
  MAX_SELF_PROMPT_LENGTH,
  updateProfile,
} from "./profile";

vi.mock(import("server-only"), () => ({}));
vi.mock(import("@/lib/turso"), () => ({ query: vi.fn() }));

const emptyResult = { rows: [], rowsAffected: 0, lastInsertRowId: null };

describe("getProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fall back to defaults for missing keys", async () => {
    vi.mocked(query).mockResolvedValue(emptyResult);

    await expect(getProfile()).resolves.toEqual({
      name: "",
      pronouns: "",
      system_prompt: DEFAULT_SELF_PROMPT,
    });
  });

  it("should overlay stored values and ignore unknown keys", async () => {
    vi.mocked(query).mockResolvedValue({
      ...emptyResult,
      rows: [
        { key: "name", value: "bob" },
        { key: "favourite_colour", value: "blue" },
        { key: "system_prompt", value: 42 },
      ],
    });

    await expect(getProfile()).resolves.toEqual({
      name: "bob",
      pronouns: "",
      system_prompt: DEFAULT_SELF_PROMPT,
    });
  });
});

describe("updateProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(log, "info").mockImplementation(() => {});
    vi.mocked(query).mockResolvedValue(emptyResult);
  });

  it("should upsert each changed key and log the old and new values", async () => {
    const result = await updateProfile({ name: "  Bob ", pronouns: "he/him" });

    expect(result).toEqual({
      name: "Bob",
      pronouns: "he/him",
      system_prompt: DEFAULT_SELF_PROMPT,
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("ON CONFLICT (key) DO UPDATE"),
      ["name", "Bob", expect.any(String)],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("ON CONFLICT (key) DO UPDATE"),
      ["pronouns", "he/him", expect.any(String)],
    );
    expect(log.info).toHaveBeenCalledWith(
      { key: "name", from: "", to: "Bob" },
      "simon-bot updated itself",
    );
  });

  it("should refuse an empty update", async () => {
    await expect(updateProfile({})).rejects.toThrow("Nothing to update");
    expect(query).not.toHaveBeenCalled();
  });

  it("should reject values over their caps", async () => {
    await expect(
      updateProfile({ system_prompt: "x".repeat(MAX_SELF_PROMPT_LENGTH + 1) }),
    ).rejects.toThrow();
    await expect(updateProfile({ name: "x".repeat(41) })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
});

describe("buildProfileContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should render placeholders and the default prompt on a blank slate", async () => {
    vi.mocked(query).mockResolvedValue(emptyResult);

    await expect(buildProfileContext()).resolves.toBe(
      [
        "<identity>",
        "name: (not chosen yet)",
        "pronouns: (not chosen yet)",
        "</identity>",
        "",
        "<own-prompt>",
        DEFAULT_SELF_PROMPT,
        "</own-prompt>",
      ].join("\n"),
    );
  });

  it("should render chosen values", async () => {
    vi.mocked(query).mockResolvedValue({
      ...emptyResult,
      rows: [
        { key: "name", value: "bob" },
        { key: "pronouns", value: "they/them" },
        { key: "system_prompt", value: "i am bob" },
      ],
    });

    const context = await buildProfileContext();

    expect(context).toContain("name: bob\npronouns: they/them");
    expect(context).toContain("<own-prompt>\ni am bob\n</own-prompt>");
  });

  it("should fall back to defaults and log when the database fails", async () => {
    vi.spyOn(log, "error").mockImplementation(() => {});
    vi.mocked(query).mockRejectedValue(new Error("db down"));

    const context = await buildProfileContext();

    expect(context).toContain("name: (not chosen yet)");
    expect(context).toContain(DEFAULT_SELF_PROMPT);
    expect(log.error).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      "Failed to load profile, using defaults",
    );
  });
});
