import { beforeEach, describe, expect, it, vi } from "vitest";

import { log } from "@/lib/log";
import { query } from "@/lib/turso";

import {
  buildProfileContext,
  DEFAULT_PROFILE,
  DEFAULT_SELF_PROMPT,
  displayName,
  formerNames,
  getProfile,
  lastKnownProfile,
  MAX_SELF_PROMPT_LENGTH,
  selfNames,
  updateProfile,
} from "./profile";

vi.mock(import("server-only"), () => ({}));
vi.mock(import("@/lib/turso"), () => ({ query: vi.fn() }));

const emptyResult = { rows: [], rowsAffected: 0, lastInsertRowId: null };

function profileRows(values: Record<string, string>) {
  return {
    ...emptyResult,
    rows: Object.entries(values).map(([key, value]) => ({ key, value })),
  };
}

describe("name helpers", () => {
  it("should fall back to the handle until a name is chosen", () => {
    expect(displayName(DEFAULT_PROFILE)).toBe("simon-bot");
    expect(displayName({ ...DEFAULT_PROFILE, name: "Mabel" })).toBe("Mabel");
  });

  it("should list every name the bot has posted under, current first", () => {
    expect(selfNames(DEFAULT_PROFILE)).toEqual(["simon-bot"]);
    expect(
      selfNames({
        ...DEFAULT_PROFILE,
        name: "Ivo",
        former_names: JSON.stringify(["Mabel", "simon-bot"]),
      }),
    ).toEqual(["Ivo", "simon-bot", "Mabel"]);
  });

  it("should ignore unreadable former names", () => {
    expect(formerNames({ ...DEFAULT_PROFILE, former_names: "nope" })).toEqual(
      [],
    );
    expect(formerNames({ ...DEFAULT_PROFILE, former_names: "[1]" })).toEqual(
      [],
    );
  });
});

describe("getProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fall back to defaults for missing keys", async () => {
    vi.mocked(query).mockResolvedValue(emptyResult);

    await expect(getProfile()).resolves.toEqual(DEFAULT_PROFILE);
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
      ...DEFAULT_PROFILE,
      name: "bob",
    });
  });

  it("should remember the last profile that loaded", async () => {
    vi.mocked(query).mockResolvedValueOnce(profileRows({ name: "bob" }));
    await getProfile();

    expect(lastKnownProfile()).toEqual({ ...DEFAULT_PROFILE, name: "bob" });
  });

  it("should read the table every time", async () => {
    vi.mocked(query).mockResolvedValue(emptyResult);

    await getProfile();
    await getProfile();

    expect(query).toHaveBeenCalledTimes(2);
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
      ...DEFAULT_PROFILE,
      name: "Bob",
      pronouns: "he/him",
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

    await updateProfile({ name: "abc", pronouns: "b", system_prompt: "c" });

    expect(maxInFlight).toBe(3);
  });

  it("should remember the previous name on a rename", async () => {
    vi.mocked(query).mockResolvedValueOnce(
      profileRows({ name: "Mabel", former_names: JSON.stringify(["Ivo"]) }),
    );

    const result = await updateProfile({ name: "Nils" });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("ON CONFLICT (key) DO UPDATE"),
      ["former_names", JSON.stringify(["Ivo", "Mabel"]), expect.any(String)],
    );
    expect(result).toMatchObject({
      name: "Nils",
      former_names: JSON.stringify(["Ivo", "Mabel"]),
    });
  });

  it("should not record a rename to the same name or from no name", async () => {
    vi.mocked(query).mockResolvedValueOnce(profileRows({ name: "Mabel" }));
    await updateProfile({ name: "Mabel" });

    vi.mocked(query).mockResolvedValueOnce(emptyResult);
    await updateProfile({ name: "Ivo" });

    expect(query).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining(["former_names"]),
    );
  });

  it("should report which keys landed when a write fails", async () => {
    vi.mocked(query).mockImplementation(async (sql, args) => {
      if (!sql.includes("INSERT")) return emptyResult;
      if (args?.[0] === "pronouns") throw new Error("write failed");
      return emptyResult;
    });

    await expect(
      updateProfile({ name: "Bob", pronouns: "he/him" }),
    ).rejects.toThrow("Failed to save pronouns (name saved)");
    expect(log.info).toHaveBeenCalledWith(
      { key: "name", from: "", to: "Bob" },
      "simon-bot updated itself",
    );
    expect(log.info).not.toHaveBeenCalledWith(
      expect.objectContaining({ key: "pronouns" }),
      expect.anything(),
    );
  });

  it("should say nothing was saved when every write fails", async () => {
    vi.mocked(query).mockImplementation(async (sql) => {
      if (!sql.includes("INSERT")) return emptyResult;
      throw new Error("db down");
    });

    await expect(
      updateProfile({ name: "Bob", pronouns: "he/him" }),
    ).rejects.toThrow("Failed to save name, pronouns (nothing saved)");
    expect(log.info).not.toHaveBeenCalled();
  });

  it("should refuse names too short to be a safe trigger", async () => {
    await expect(updateProfile({ name: "ok" })).rejects.toThrow(
      "at least 3 characters",
    );
    expect(query).not.toHaveBeenCalled();
  });

  it("should refuse an empty update", async () => {
    await expect(updateProfile({})).rejects.toThrow("Nothing to update");
    expect(query).not.toHaveBeenCalled();
  });

  it("should refuse names that can't work as a chat prefix", async () => {
    await expect(updateProfile({ name: "me: too" })).rejects.toThrow(
      "colons or line breaks",
    );
    await expect(updateProfile({ name: "two\nlines" })).rejects.toThrow();
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
  });

  it("should render the default identity and prompt on a blank slate", async () => {
    vi.mocked(query).mockResolvedValue(emptyResult);

    await expect(buildProfileContext()).resolves.toBe(
      [
        "<identity>",
        "name: simon-bot (the default - you haven't picked one yet)",
        "pronouns: (not chosen yet)",
        "</identity>",
        "",
        "<own-prompt>",
        DEFAULT_SELF_PROMPT,
        "</own-prompt>",
      ].join("\n"),
    );
  });

  it("should render chosen values and former names", async () => {
    vi.mocked(query).mockResolvedValue(
      profileRows({
        name: "bob",
        pronouns: "they/them",
        system_prompt: "i am bob",
        former_names: JSON.stringify(["Mabel", "Ivo"]),
      }),
    );

    const context = await buildProfileContext();

    expect(context).toContain(
      "name: bob\npronouns: they/them\nformer names: Mabel, Ivo",
    );
    expect(context).toContain("<own-prompt>\ni am bob\n</own-prompt>");
  });

  it("should fall back to the last known profile and log when the database fails", async () => {
    vi.spyOn(log, "error").mockImplementation(() => {});
    vi.mocked(query).mockResolvedValueOnce(profileRows({ name: "bob" }));
    await getProfile();
    vi.mocked(query).mockRejectedValue(new Error("db down"));

    const context = await buildProfileContext();

    expect(context).toContain("name: bob");
    expect(context).toContain(DEFAULT_SELF_PROMPT);
    expect(log.error).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      "Failed to load profile, using the last known one",
    );
  });

  it("should fall back to defaults when nothing has loaded yet", async () => {
    vi.spyOn(log, "error").mockImplementation(() => {});
    vi.mocked(query).mockResolvedValueOnce(emptyResult);
    await getProfile();
    vi.mocked(query).mockRejectedValue(new Error("db down"));

    const context = await buildProfileContext();

    expect(context).toContain("name: simon-bot (the default");
  });
});
