// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { log } from "@/lib/log";
import { query } from "@/lib/turso";
import { createSqliteQuery } from "@/mocks/sqlite";

import {
  buildMemoryContext,
  edit,
  forget,
  MAX_CONTENT_LENGTH,
  MAX_PER_CATEGORY,
  peopleCategory,
  recall,
  remember,
} from "./memory";
import { MIGRATIONS } from "./migrations";

vi.mock(import("server-only"), () => ({}));
vi.mock(import("@/lib/turso"), () => ({ query: vi.fn() }));

const CREATED_AT = "2025-01-01T00:00:00.000Z";

async function seed(
  id: number,
  category: string,
  content: string,
  createdAt = CREATED_AT,
) {
  await query(
    "INSERT INTO memories (id, category, content, created_at) VALUES (?, ?, ?, ?)",
    [id, category, content, createdAt],
  );
}

async function fill(category: string, count: number) {
  for (let i = 0; i < count; i++) await seed(100 + i, category, `note ${i}`);
}

async function stored(id: number) {
  const { rows } = await query(
    "SELECT category, content FROM memories WHERE id = ?",
    [id],
  );
  return rows[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(query).mockImplementation(createSqliteQuery(MIGRATIONS));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("peopleCategory", () => {
  it("should slugify usernames under the people prefix", () => {
    expect(peopleCategory("Adventurous Fox")).toBe("people/adventurous-fox");
    expect(peopleCategory("fair-minded_owl")).toBe("people/fair-minded_owl");
    expect(peopleCategory("  Simon Kjellberg!  ")).toBe(
      "people/simon-kjellberg",
    );
  });

  it("should return undefined when nothing survives slugifying", () => {
    expect(peopleCategory("!!!")).toBeUndefined();
    expect(peopleCategory("")).toBeUndefined();
  });
});

describe("remember", () => {
  it("should store a normalised note and return it", async () => {
    vi.useFakeTimers({ now: new Date(CREATED_AT), toFake: ["Date"] });

    const result = await remember({
      category: "  Self ",
      content: "  i like trains  ",
    });

    expect(result).toEqual({
      status: "ok",
      memory: {
        id: expect.any(Number),
        category: "self",
        content: "i like trains",
        createdAt: CREATED_AT,
      },
    });
    expect(await recall({})).toEqual(
      result.status === "ok" ? [result.memory] : [],
    );
  });

  it("should reject invalid categories", async () => {
    await expect(
      remember({ category: "Not A Category!", content: "x" }),
    ).rejects.toThrow();
    await expect(
      remember({ category: "a/b/c", content: "x" }),
    ).rejects.toThrow();
    expect(await recall({})).toEqual([]);
  });

  it("should reject empty or overlong content", async () => {
    await expect(
      remember({ category: "self", content: "   " }),
    ).rejects.toThrow();
    await expect(
      remember({
        category: "self",
        content: "x".repeat(MAX_CONTENT_LENGTH + 1),
      }),
    ).rejects.toThrow();
    expect(await recall({})).toEqual([]);
  });

  it("should refuse when the category is full", async () => {
    await fill("jokes", MAX_PER_CATEGORY);

    await expect(
      remember({ category: "jokes", content: "one more" }),
    ).resolves.toEqual({ status: "full", category: "jokes" });
    expect(await recall({ category: "jokes", limit: 100 })).toHaveLength(
      MAX_PER_CATEGORY,
    );
  });

  it("should not let parallel notes slip past the cap", async () => {
    await fill("jokes", MAX_PER_CATEGORY - 1);

    const results = await Promise.all([
      remember({ category: "jokes", content: "a" }),
      remember({ category: "jokes", content: "b" }),
    ]);

    expect(results.filter((result) => result.status === "ok")).toHaveLength(1);
    expect(await recall({ category: "jokes", limit: 100 })).toHaveLength(
      MAX_PER_CATEGORY,
    );
  });
});

describe("recall", () => {
  it("should list everything newest first, 20 by default", async () => {
    for (let i = 1; i <= 21; i++) {
      await seed(
        i,
        "jokes",
        `joke ${i}`,
        `2025-01-${String(i).padStart(2, "0")}T00:00:00.000Z`,
      );
    }

    const memories = await recall({});

    expect(memories).toHaveLength(20);
    expect(memories[0]).toEqual({
      id: 21,
      category: "jokes",
      content: "joke 21",
      createdAt: "2025-01-21T00:00:00.000Z",
    });
    expect(memories.at(-1)?.id).toBe(2);
  });

  it("should break ties on the newest id", async () => {
    await seed(1, "jokes", "first");
    await seed(2, "jokes", "second");

    expect((await recall({})).map((memory) => memory.id)).toEqual([2, 1]);
  });

  it("should filter by category and search text literally", async () => {
    await seed(1, "jokes", "50%_off\\ everything");
    await seed(2, "jokes", "500 offers");
    await seed(3, "self", "50%_off\\ too");

    const memories = await recall({
      category: "Jokes",
      search: "50%_off\\",
      limit: 5,
    });

    expect(memories.map((memory) => memory.id)).toEqual([1]);
  });
});

describe("edit", () => {
  it("should rewrite a note only when its text still matches", async () => {
    await seed(4, "self", "i like cats");

    await expect(
      edit({ id: 4, oldContent: " i like cats ", newContent: "i like trains" }),
    ).resolves.toEqual({
      status: "ok",
      memory: {
        id: 4,
        category: "self",
        content: "i like trains",
        createdAt: CREATED_AT,
      },
    });
  });

  it("should move a note to another category when asked", async () => {
    await seed(4, "style", "this chat gets spam");

    await expect(
      edit({
        id: 4,
        oldContent: "this chat gets spam",
        newContent: "this chat gets spam",
        category: " Context ",
      }),
    ).resolves.toMatchObject({ status: "ok", memory: { category: "context" } });
    expect(await stored(4)).toEqual({
      category: "context",
      content: "this chat gets spam",
    });
  });

  it("should edit a note in place in a full category", async () => {
    await fill("self", MAX_PER_CATEGORY);

    await expect(
      edit({
        id: 100,
        oldContent: "note 0",
        newContent: "note zero",
        category: "self",
      }),
    ).resolves.toMatchObject({ status: "ok" });
  });

  it("should refuse to move a note into a full category", async () => {
    await seed(4, "style", "this chat gets spam");
    await fill("context", MAX_PER_CATEGORY);

    await expect(
      edit({
        id: 4,
        oldContent: "this chat gets spam",
        newContent: "this chat gets spam",
        category: "context",
      }),
    ).resolves.toEqual({ status: "full", category: "context" });
    expect(await stored(4)).toEqual({
      category: "style",
      content: "this chat gets spam",
    });
  });

  it("should validate the category before moving", async () => {
    await seed(4, "self", "x");

    await expect(
      edit({ id: 4, oldContent: "x", newContent: "y", category: "Not Valid!" }),
    ).rejects.toThrow();
    expect(await stored(4)).toEqual({ category: "self", content: "x" });
  });

  it.each(["- #4 i like cats", "#4 i like cats"])(
    "should accept the text copied straight from the listing: %s",
    async (oldContent) => {
      await seed(4, "self", "i like cats");

      await expect(
        edit({ id: 4, oldContent, newContent: "i like trains" }),
      ).resolves.toMatchObject({ status: "ok" });
    },
  );

  it("should only strip a listing prefix that names this note", async () => {
    await seed(4, "self", "not mine");

    await expect(
      edit({ id: 4, oldContent: "#41 not mine", newContent: "mine now" }),
    ).resolves.toMatchObject({ status: "stale" });
  });

  it("should hand back the current text when the note changed", async () => {
    await seed(4, "self", "i like dogs");

    await expect(
      edit({ id: 4, oldContent: "i like cats", newContent: "i like trains" }),
    ).resolves.toEqual({
      status: "stale",
      current: expect.objectContaining({ id: 4, content: "i like dogs" }),
    });
    expect(await stored(4)).toEqual({
      category: "self",
      content: "i like dogs",
    });
  });

  it("should say when the note is gone", async () => {
    await expect(
      edit({ id: 4, oldContent: "i like cats", newContent: "i like trains" }),
    ).resolves.toEqual({ status: "missing", id: 4 });
  });

  it("should validate the new text before writing", async () => {
    await seed(4, "self", "x");

    await expect(
      edit({ id: 4, oldContent: "x", newContent: " " }),
    ).rejects.toThrow();
    expect(await stored(4)).toEqual({ category: "self", content: "x" });
  });
});

describe("forget", () => {
  it("should delete a note only when its text still matches", async () => {
    await seed(4, "self", "i like cats");

    await expect(
      forget({ id: 4, content: " - #4 i like cats " }),
    ).resolves.toEqual({ status: "ok" });
    expect(await stored(4)).toBeUndefined();
  });

  it("should hand back the current text when the note changed", async () => {
    await seed(4, "self", "i like dogs");

    await expect(forget({ id: 4, content: "i like cats" })).resolves.toEqual({
      status: "stale",
      current: expect.objectContaining({ id: 4, content: "i like dogs" }),
    });
    expect(await stored(4)).toBeDefined();
  });

  it("should say when the note is gone", async () => {
    await expect(forget({ id: 4, content: "i like cats" })).resolves.toEqual({
      status: "missing",
      id: 4,
    });
  });
});

describe("buildMemoryContext", () => {
  it("should render core categories, participants, and an index of the rest", async () => {
    await seed(1, "self", "my name is simon-bot");
    await seed(2, "self", "i live in a docker container");
    await seed(3, "interests", "trains");
    await seed(4, "people/alice", "likes cats");
    await seed(5, "people/zed", "likes dogs");
    await seed(6, "people/zed", "lives in a shoe");
    for (let i = 0; i < 7; i++) await seed(10 + i, "jokes", `joke ${i}`);

    const context = await buildMemoryContext(["Alice", "Alice", "!!!"]);

    expect(context).toBe(
      [
        "<memory>",
        "## self",
        "- #1 my name is simon-bot",
        "- #2 i live in a docker container",
        "",
        "## style",
        "(nothing yet)",
        "",
        "## interests",
        "- #3 trains",
        "",
        "## context",
        "(nothing yet)",
        "",
        "## people/alice",
        "- #4 likes cats",
        "",
        "Other categories, use recall to read them: jokes (7), people/zed (2)",
        "</memory>",
      ].join("\n"),
    );
  });

  it("should omit the index when every category is shown", async () => {
    await seed(1, "self", "hi");

    const context = await buildMemoryContext([]);

    expect(context).not.toContain("Other categories");
    expect(context).toContain("## style\n(nothing yet)");
  });

  it("should return an empty string and log when the database fails", async () => {
    vi.spyOn(log, "error").mockImplementation(() => {});
    vi.mocked(query).mockRejectedValue(new Error("db down"));

    await expect(buildMemoryContext(["Alice"])).resolves.toBe("");
    expect(log.error).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      "Failed to build memory context",
    );
  });
});
