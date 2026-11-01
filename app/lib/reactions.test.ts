// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { addBotReaction, removeBotReaction } from "@/lib/discord/api";
import { log } from "@/lib/log";
import type { Username } from "@/lib/session";
import { batch, query } from "@/lib/turso";
import { createMessage } from "@/mocks/messages";
import {
  emptyResult,
  failQuery,
  sqliteBeforeEach,
  selectRows,
} from "@/mocks/sqlite";

import { REACTION_EMOJI } from "./emoji";
import { MIGRATIONS } from "./migrations";
import {
  addReaction,
  EmojiSchema,
  markOwnReactions,
  toggleReaction,
  withSiteReactions,
} from "./reactions";

vi.mock(import("@/lib/turso"), async () =>
  (await import("@/mocks/sqlite")).mockTurso(),
);
vi.mock(import("@/lib/discord/api"), () => ({
  addBotReaction: vi.fn(() => Promise.resolve()),
  removeBotReaction: vi.fn(() => Promise.resolve()),
}));

const alice = "alice" as Username;
const bob = "bob" as Username;

const sqlite = sqliteBeforeEach(query, MIGRATIONS);

async function storedReactions() {
  return await selectRows(sqlite(), "SELECT * FROM reactions");
}

describe("toggleReaction", () => {
  it("adds a reaction and mirrors it on Discord", async () => {
    expect(await toggleReaction("1", "👍", alice)).toBe("added");

    expect(addBotReaction).toHaveBeenCalledWith("1", "👍");
  });

  it("keeps the bot's reaction while other visitors still react", async () => {
    await toggleReaction("1", "👍", alice);
    await toggleReaction("1", "👍", bob);

    expect(await toggleReaction("1", "👍", alice)).toBe("removed");
    expect(removeBotReaction).not.toHaveBeenCalled();

    expect(await toggleReaction("1", "👍", bob)).toBe("removed");
    expect(removeBotReaction).toHaveBeenCalledWith("1", "👍");
  });

  it("still removes the reaction when Discord fails to drop the mirror", async () => {
    vi.mocked(removeBotReaction).mockRejectedValueOnce(new Error("down"));
    await toggleReaction("1", "👍", alice);

    expect(await toggleReaction("1", "👍", alice)).toBe("removed");
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it("removes nothing when counting the rest fails", async () => {
    await toggleReaction("1", "👍", alice);
    vi.mocked(query).mockImplementation(
      failQuery(sqlite(), "SELECT EXISTS", { error: new Error("blip") }),
    );

    await expect(toggleReaction("1", "👍", alice)).rejects.toThrow("blip");
    expect(await storedReactions()).toHaveLength(1);
    expect(removeBotReaction).not.toHaveBeenCalled();
  });

  it("replaces the user's other tones of the emoji once the new one is in", async () => {
    await addReaction("1", "👍🏽", alice);
    await addReaction("1", "🎉", alice);
    await addReaction("1", "👍🏽", bob);
    await addReaction("1", "👍", alice);

    await addReaction("1", "👍🏿", alice);

    expect(
      (await storedReactions()).map(({ emoji, username }) => [emoji, username]),
    ).toEqual([
      ["🎉", "alice"],
      ["👍🏽", "bob"],
      ["👍🏿", "alice"],
    ]);
    expect(removeBotReaction).toHaveBeenCalledExactlyOnceWith("1", "👍");
  });

  it("drops a leftover tone when the user adds the one they already have", async () => {
    await query(
      "INSERT INTO reactions (message_id, emoji, username) VALUES ('1', '👍🏽', 'alice'), ('1', '👍🏿', 'alice')",
    );

    await addReaction("1", "👍🏿", alice);

    expect(await storedReactions()).toMatchObject([{ emoji: "👍🏿" }]);
    expect(addBotReaction).not.toHaveBeenCalled();
  });

  it("keeps the old tone when Discord turns the new one away", async () => {
    await addReaction("1", "👍🏽", alice);
    vi.mocked(addBotReaction).mockRejectedValueOnce(new Error("404"));

    await expect(addReaction("1", "👍🏿", alice)).rejects.toThrow("404");
    expect(await storedReactions()).toMatchObject([{ emoji: "👍🏽" }]);
  });

  it("still adds when replacing the other tones fails", async () => {
    await addReaction("1", "👍🏽", alice);
    vi.mocked(query).mockImplementation(
      failQuery(sqlite(), "SELECT emoji", { error: new Error("blip") }),
    );

    await addReaction("1", "👍🏿", alice);

    expect(await storedReactions()).toHaveLength(2);
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it("keeps one reaction when the same one is added twice", async () => {
    await addReaction("1", "👍", alice);
    await addReaction("1", "👍", alice);

    expect(await storedReactions()).toHaveLength(1);
    expect(addBotReaction).toHaveBeenCalledOnce();
  });

  it("adds nothing when Discord turns the reaction away", async () => {
    vi.mocked(addBotReaction).mockRejectedValueOnce(new Error("404"));

    await expect(toggleReaction("1", "👍", alice)).rejects.toThrow("404");
    expect(await storedReactions()).toEqual([]);
  });

  it("keeps Discord's error when the rollback fails", async () => {
    vi.mocked(addBotReaction).mockRejectedValueOnce(new Error("30010"));
    vi.mocked(query).mockImplementation(
      failQuery(sqlite(), "DELETE", { error: new Error("timeout") }),
    );

    await expect(addReaction("1", "👍", alice)).rejects.toThrow("30010");
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it("leaves the mirror to the concurrent add that created the row", async () => {
    await query(
      "INSERT INTO reactions (message_id, emoji, username) VALUES ('1', '👍', 'alice')",
    );
    // The concurrent request's row lands between this one's DELETE and INSERT.
    vi.mocked(batch).mockResolvedValueOnce([emptyResult, emptyResult]);
    vi.mocked(query).mockResolvedValueOnce(emptyResult);

    expect(await toggleReaction("1", "👍", alice)).toBe("added");
    expect(addBotReaction).not.toHaveBeenCalled();
    expect(await storedReactions()).toHaveLength(1);
  });
});

describe("markOwnReactions", () => {
  it("marks the visitor's reactions and leaves them out of the names, replies included", () => {
    const messages = [
      createMessage({
        id: "1",
        reactions: [
          { emoji: "👍", count: 2, users: ["alice", "bob"] },
          { emoji: "🎉", count: 1, users: ["bob"] },
        ],
        replies: [
          createMessage({
            id: "2",
            reactions: [{ emoji: "😂", count: 1, users: ["alice"] }],
          }),
        ],
      }),
    ];

    const [marked] = markOwnReactions(messages, "alice");

    expect(marked?.reactions).toEqual([
      { emoji: "👍", count: 2, users: ["bob"], mine: true },
      { emoji: "🎉", count: 1, users: ["bob"] },
    ]);
    expect(marked?.replies[0]?.reactions).toEqual([
      { emoji: "😂", count: 1, users: [], mine: true },
    ]);
  });
});

describe("withSiteReactions", () => {
  it("adds the site's reactions to Discord's, replies included", async () => {
    await toggleReaction("1", "😂", alice);
    await toggleReaction("1", "👍", alice);
    await toggleReaction("1", "👍", bob);
    await toggleReaction("2", "🎉", bob);

    const messages = await withSiteReactions([
      createMessage({
        id: "1",
        reactions: [{ emoji: "👍", count: 1, users: ["simon"] }],
        replies: [createMessage({ id: "2" })],
      }),
      createMessage({
        id: "3",
        reactions: [{ emoji: "😮", count: 2, users: [] }],
      }),
    ]);

    expect(messages).toMatchObject([
      {
        id: "1",
        reactions: [
          { emoji: "👍", count: 3, users: ["simon", "alice", "bob"] },
          { emoji: "😂", count: 1, users: ["alice"] },
        ],
        replies: [
          { id: "2", reactions: [{ emoji: "🎉", count: 1, users: ["bob"] }] },
        ],
      },
      { id: "3", reactions: [{ emoji: "😮", count: 2, users: [] }] },
    ]);
  });

  it("falls back to Discord's reactions when Turso fails", async () => {
    vi.mocked(query).mockRejectedValueOnce(new Error("down"));
    const messages = [createMessage({ id: "1" })];

    expect(await withSiteReactions(messages)).toBe(messages);
    expect(log.error).toHaveBeenCalledOnce();
  });

  it("skips the query without messages", async () => {
    expect(await withSiteReactions([])).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});

describe("EmojiSchema", () => {
  it.each([...REACTION_EMOJI.map(({ emoji }) => emoji), "👍🏽", "🏳️‍🌈", "1️⃣"])(
    "accepts %s",
    (emoji) => {
      expect(EmojiSchema.safeParse(emoji).success).toBe(true);
    },
  );

  it.each(["", "a", "👍👍", "👍 ", ":joy:"])("rejects %j", (text) => {
    expect(EmojiSchema.safeParse(text).success).toBe(false);
  });
});
