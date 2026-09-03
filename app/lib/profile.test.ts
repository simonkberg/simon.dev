import { beforeEach, describe, expect, it, vi } from "vitest";

import { log } from "@/lib/log";
import { query } from "@/lib/turso";

import {
  _resetProfileCache,
  buildProfileContext,
  DEFAULT_SELF_PROMPT,
  getChosenName,
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
    _resetProfileCache();
    vi.useRealTimers();
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

  it("should cache the profile for a minute", async () => {
    vi.useFakeTimers();
    vi.mocked(query).mockResolvedValue(emptyResult);

    await getProfile();
    await getProfile();
    expect(query).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60_001);
    await getProfile();
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("should keep the last known profile when a refresh fails", async () => {
    vi.spyOn(log, "error").mockImplementation(() => {});
    vi.useFakeTimers();
    vi.mocked(query).mockResolvedValue({
      ...emptyResult,
      rows: [{ key: "name", value: "bob" }],
    });
    await getProfile();

    vi.advanceTimersByTime(60_001);
    vi.mocked(query).mockRejectedValue(new Error("db down"));

    await expect(getProfile()).resolves.toMatchObject({ name: "bob" });
    expect(log.error).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      "Failed to refresh the profile, keeping the last known one",
    );
  });

  it("should throw when nothing was ever loaded", async () => {
    vi.mocked(query).mockRejectedValue(new Error("db down"));

    await expect(getProfile()).rejects.toThrow("db down");
  });
});

describe("updateProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetProfileCache();
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

  it("should write the changed keys in parallel", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    vi.mocked(query).mockImplementation(async (sql) => {
      if (!sql.includes("INSERT")) return emptyResult;
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight--;
      return emptyResult;
    });

    await updateProfile({ name: "a", pronouns: "b", system_prompt: "c" });

    expect(maxInFlight).toBe(3);
  });

  it("should refuse an empty update", async () => {
    await expect(updateProfile({})).rejects.toThrow("Nothing to update");
    expect(query).not.toHaveBeenCalled();
  });

  it("should refuse the name Simon", async () => {
    await expect(updateProfile({ name: " SIMON " })).rejects.toThrow(
      "pick another name",
    );
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
    _resetProfileCache();
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

describe("getChosenName", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetProfileCache();
    vi.useRealTimers();
  });

  it("should read the name through the cached profile", async () => {
    vi.mocked(query).mockResolvedValue({
      ...emptyResult,
      rows: [{ key: "name", value: "bob" }],
    });

    await expect(getChosenName()).resolves.toBe("bob");
    await expect(getChosenName()).resolves.toBe("bob");
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("should forget the cached name when the profile changes", async () => {
    vi.spyOn(log, "info").mockImplementation(() => {});
    vi.mocked(query).mockResolvedValue({
      ...emptyResult,
      rows: [{ key: "name", value: "bob" }],
    });
    await expect(getChosenName()).resolves.toBe("bob");

    vi.mocked(query).mockResolvedValue({
      ...emptyResult,
      rows: [{ key: "name", value: "alice" }],
    });
    await updateProfile({ name: "alice" });

    await expect(getChosenName()).resolves.toBe("alice");
  });

  it("should fall back to no name when nothing was ever loaded", async () => {
    vi.spyOn(log, "error").mockImplementation(() => {});
    vi.mocked(query).mockRejectedValue(new Error("db down"));

    await expect(getChosenName()).resolves.toBe("");
  });
});
