import { beforeEach, describe, expect, it, vi } from "vitest";

import { log } from "@/lib/log";
import { query } from "@/lib/turso";

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

vi.mock(import("server-only"), () => ({}));
vi.mock(import("@/lib/turso"), () => ({ query: vi.fn() }));

const emptyResult = { rows: [], rowsAffected: 0, lastInsertRowId: null };

function row(
  id: number,
  category: string,
  content: string,
  createdAt = "2025-01-01T00:00:00.000Z",
) {
  return { id, category, content, created_at: createdAt };
}

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
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should insert a normalised note and return it", async () => {
    vi.mocked(query).mockResolvedValueOnce({
      ...emptyResult,
      rows: [row(9, "self", "i like trains")],
    });

    await expect(
      remember({ category: "  Self ", content: "  i like trains  " }),
    ).resolves.toEqual({
      id: 9,
      category: "self",
      content: "i like trains",
      createdAt: "2025-01-01T00:00:00.000Z",
    });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, args] = vi.mocked(query).mock.calls[0] ?? [];
    expect(sql).toContain("INSERT INTO memories");
    expect(sql).toContain(
      "WHERE (SELECT COUNT(*) FROM memories WHERE category = ?) < ?",
    );
    expect(args).toEqual([
      "self",
      "i like trains",
      expect.any(String),
      "self",
      MAX_PER_CATEGORY,
    ]);
  });

  it("should reject invalid categories", async () => {
    await expect(
      remember({ category: "Not A Category!", content: "x" }),
    ).rejects.toThrow();
    await expect(
      remember({ category: "a/b/c", content: "x" }),
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
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
    expect(query).not.toHaveBeenCalled();
  });

  it("should refuse when the category is full", async () => {
    vi.mocked(query).mockResolvedValueOnce(emptyResult);

    await expect(
      remember({ category: "jokes", content: "one more" }),
    ).rejects.toThrow('Category "jokes" is full');
    expect(query).toHaveBeenCalledTimes(1);
  });
});

describe("recall", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(query).mockResolvedValue({
      ...emptyResult,
      rows: [row(2, "jokes", "second"), row(1, "jokes", "first")],
    });
  });

  it("should list everything newest first with the default limit", async () => {
    await expect(recall({})).resolves.toEqual([
      {
        id: 2,
        category: "jokes",
        content: "second",
        createdAt: "2025-01-01T00:00:00.000Z",
      },
      {
        id: 1,
        category: "jokes",
        content: "first",
        createdAt: "2025-01-01T00:00:00.000Z",
      },
    ]);

    const [sql, args] = vi.mocked(query).mock.calls[0] ?? [];
    expect(sql).not.toContain("WHERE");
    expect(sql).toContain("ORDER BY created_at DESC, id DESC LIMIT ?");
    expect(args).toEqual([20]);
  });

  it("should filter by category and escaped search text", async () => {
    await recall({ category: "Jokes", search: "50%_off\\", limit: 5 });

    const [sql, args] = vi.mocked(query).mock.calls[0] ?? [];
    expect(sql).toContain("WHERE category = ? AND content LIKE ? ESCAPE '\\'");
    expect(args).toEqual(["jokes", "%50\\%\\_off\\\\%", 5]);
  });
});

describe("edit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should rewrite a note only when its text still matches", async () => {
    vi.mocked(query).mockResolvedValue({
      ...emptyResult,
      rows: [row(4, "self", "i like trains")],
    });

    await expect(
      edit({ id: 4, oldContent: " i like cats ", newContent: "i like trains" }),
    ).resolves.toEqual({
      status: "ok",
      memory: {
        id: 4,
        category: "self",
        content: "i like trains",
        createdAt: "2025-01-01T00:00:00.000Z",
      },
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("WHERE id = ? AND content IN (?, ?)"),
      [
        "i like trains",
        null,
        4,
        "i like cats",
        "i like cats",
        null,
        null,
        null,
        MAX_PER_CATEGORY,
      ],
    );
  });

  it("should move a note to another category when asked", async () => {
    vi.mocked(query).mockResolvedValue({
      ...emptyResult,
      rows: [row(4, "context", "this chat gets spam")],
    });

    await expect(
      edit({
        id: 4,
        oldContent: "this chat gets spam",
        newContent: "this chat gets spam",
        category: " Context ",
      }),
    ).resolves.toMatchObject({ status: "ok", memory: { category: "context" } });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("category = COALESCE(?, category)"),
      [
        "this chat gets spam",
        "context",
        4,
        "this chat gets spam",
        "this chat gets spam",
        "context",
        "context",
        "context",
        MAX_PER_CATEGORY,
      ],
    );
  });

  it("should refuse to move a note into a full category", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce(emptyResult)
      .mockResolvedValueOnce({
        ...emptyResult,
        rows: [row(4, "style", "this chat gets spam")],
      });

    await expect(
      edit({
        id: 4,
        oldContent: "this chat gets spam",
        newContent: "this chat gets spam",
        category: "context",
      }),
    ).resolves.toEqual({ status: "full", category: "context" });
  });

  it("should validate the category before moving", async () => {
    await expect(
      edit({ id: 4, oldContent: "x", newContent: "y", category: "Not Valid!" }),
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it("should accept the text copied straight from the listing", async () => {
    vi.mocked(query).mockResolvedValue({
      ...emptyResult,
      rows: [row(4, "self", "i like trains")],
    });

    await edit({
      id: 4,
      oldContent: "- #4 i like cats",
      newContent: "i like trains",
    });
    await edit({
      id: 4,
      oldContent: "#4 i like cats",
      newContent: "i like trains",
    });
    await edit({
      id: 4,
      oldContent: "#41 not mine",
      newContent: "i like trains",
    });

    expect(
      vi.mocked(query).mock.calls.map(([, args]) => args?.slice(3, 5)),
    ).toEqual([
      ["- #4 i like cats", "i like cats"],
      ["#4 i like cats", "i like cats"],
      ["#41 not mine", "#41 not mine"],
    ]);
  });

  it("should hand back the current text when the note changed", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce(emptyResult)
      .mockResolvedValueOnce({
        ...emptyResult,
        rows: [row(4, "self", "i like dogs")],
      });

    await expect(
      edit({ id: 4, oldContent: "i like cats", newContent: "i like trains" }),
    ).resolves.toEqual({
      status: "stale",
      current: expect.objectContaining({ id: 4, content: "i like dogs" }),
    });
  });

  it("should say when the note is gone", async () => {
    vi.mocked(query).mockResolvedValue(emptyResult);

    await expect(
      edit({ id: 4, oldContent: "i like cats", newContent: "i like trains" }),
    ).resolves.toEqual({ status: "missing" });
  });

  it("should validate the new text before writing", async () => {
    await expect(
      edit({ id: 4, oldContent: "x", newContent: " " }),
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
});

describe("forget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should delete a note only when its text still matches", async () => {
    vi.mocked(query).mockResolvedValueOnce({ ...emptyResult, rowsAffected: 1 });

    await expect(
      forget({ id: 4, content: " - #4 i like cats " }),
    ).resolves.toEqual({ status: "ok" });
    expect(query).toHaveBeenCalledWith(
      "DELETE FROM memories WHERE id = ? AND content IN (?, ?)",
      [4, "- #4 i like cats", "i like cats"],
    );
  });

  it("should hand back the current text when the note changed", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ ...emptyResult, rowsAffected: 0 })
      .mockResolvedValueOnce({
        ...emptyResult,
        rows: [row(4, "self", "i like dogs")],
      });

    await expect(forget({ id: 4, content: "i like cats" })).resolves.toEqual({
      status: "stale",
      current: expect.objectContaining({ id: 4, content: "i like dogs" }),
    });
  });

  it("should say when the note is gone", async () => {
    vi.mocked(query).mockResolvedValue(emptyResult);

    await expect(forget({ id: 4, content: "i like cats" })).resolves.toEqual({
      status: "missing",
    });
  });
});

describe("buildMemoryContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should render core categories, participants, and an index of the rest", async () => {
    vi.mocked(query).mockImplementation(async (sql) => {
      if (sql.includes("GROUP BY category")) {
        return {
          ...emptyResult,
          rows: [
            { category: "interests", count: 1 },
            { category: "jokes", count: 7 },
            { category: "people/alice", count: 1 },
            { category: "people/zed", count: 2 },
            { category: "self", count: 2 },
          ],
        };
      }
      return {
        ...emptyResult,
        rows: [
          row(1, "self", "my name is simon-bot"),
          row(2, "self", "i live in a docker container"),
          row(3, "interests", "trains"),
          row(4, "people/alice", "likes cats"),
        ],
      };
    });

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

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("WHERE category IN (?, ?, ?, ?, ?)"),
      ["self", "style", "interests", "context", "people/alice"],
    );
  });

  it("should omit the index when every category is shown", async () => {
    vi.mocked(query).mockResolvedValue(emptyResult);

    const context = await buildMemoryContext([]);

    expect(context).not.toContain("Other categories");
    expect(context).toContain("## self\n(nothing yet)");
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
