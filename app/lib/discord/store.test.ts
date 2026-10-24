import { beforeEach, describe, expect, it, vi } from "vitest";

import { log } from "@/lib/log";
import { message, reaction } from "@/mocks/discord";
import { mockEnv } from "@/mocks/env";

import type { ChannelEvent, DiscordMessage } from "./schemas";
import { ChannelStore, type Reactor, type StoreSource, WINDOW } from "./store";

const CHANNEL = mockEnv.DISCORD_CHANNEL_ID;
const BOT = "bot-user-id";
const SMILE = { id: null, name: "😄" };

type Emoji = { id: string | null; name: string | null };
type ReactionAdd = Extract<ChannelEvent, { t: "MESSAGE_REACTION_ADD" }>;
type MessageCreate = Extract<ChannelEvent, { t: "MESSAGE_CREATE" }>;
type MessageUpdate = Extract<ChannelEvent, { t: "MESSAGE_UPDATE" }>;

function users(ids: string[]): Reactor[] {
  return ids.map((id) => ({ id }));
}

function reacted(id: string, count = 1, me = false) {
  return message(id, { reactions: [reaction(SMILE.name, count, me)] });
}

function createStore(messages: DiscordMessage[] = [message("1")]) {
  const source = {
    fetchMessages: vi.fn<StoreSource["fetchMessages"]>(async () => messages),
    fetchMessage: vi.fn<StoreSource["fetchMessage"]>(async (id) => message(id)),
    fetchReactors: vi.fn<StoreSource["fetchReactors"]>(async () => []),
    fetchMemberName: vi.fn<StoreSource["fetchMemberName"]>(
      async (id) => `member ${id}`,
    ),
    botUserId: vi.fn<StoreSource["botUserId"]>(() => BOT),
  };
  const store = new ChannelStore(source);
  const listener = vi.fn(() => store.revision);
  store.listen(listener);
  return { store, source, listener };
}

// A store whose first seed has landed, with the listener cleared of it.
async function seeded(messages?: DiscordMessage[]) {
  const created = createStore(messages);
  await created.store.messages();
  created.listener.mockClear();
  return created;
}

// Lands an event during every fetch, so no seed settles.
function churn(store: ChannelStore, messages = [message("1")]) {
  return async () => {
    store.apply(del("x"));
    return messages;
  };
}

function defer<T>(mock: { mockReturnValueOnce(value: Promise<T>): unknown }) {
  const deferred = Promise.withResolvers<T>();
  mock.mockReturnValueOnce(deferred.promise);
  return deferred;
}

async function stored(store: ChannelStore, id: string) {
  return (await store.messages()).find((m) => m.id === id);
}

async function reactionsOf(store: ChannelStore, id = "1") {
  return (await stored(store, id))?.reactions;
}

function reactors(store: ChannelStore, id = "1") {
  return store.reactorIds(id, SMILE.name);
}

function create(
  m: ReturnType<typeof message>,
  member?: MessageCreate["d"]["member"],
): ChannelEvent {
  return { t: "MESSAGE_CREATE", d: { ...m, member } };
}

function update(
  id: string,
  fields: Omit<MessageUpdate["d"], "id" | "channel_id"> = {},
): ChannelEvent {
  return { t: "MESSAGE_UPDATE", d: { ...fields, id, channel_id: CHANNEL } };
}

function del(id: string): ChannelEvent {
  return { t: "MESSAGE_DELETE", d: { channel_id: CHANNEL, id } };
}

function bulkDelete(ids: string[]): ChannelEvent {
  return { t: "MESSAGE_DELETE_BULK", d: { channel_id: CHANNEL, ids } };
}

function clear(messageId = "1", emoji?: Emoji): ChannelEvent {
  return emoji
    ? {
        t: "MESSAGE_REACTION_REMOVE_EMOJI",
        d: { channel_id: CHANNEL, message_id: messageId, emoji },
      }
    : {
        t: "MESSAGE_REACTION_REMOVE_ALL",
        d: { channel_id: CHANNEL, message_id: messageId },
      };
}

function react(
  t: "MESSAGE_REACTION_ADD" | "MESSAGE_REACTION_REMOVE",
  userId: string,
  {
    messageId = "1",
    emoji = SMILE as Emoji,
    member = { user: { username: userId } } as
      | ReactionAdd["d"]["member"]
      | null,
  } = {},
): ChannelEvent {
  const d = {
    channel_id: CHANNEL,
    message_id: messageId,
    user_id: userId,
    emoji,
  };
  return t === "MESSAGE_REACTION_ADD"
    ? { t, d: { ...d, member: member ?? undefined } }
    : { t, d };
}

beforeEach(() => {
  vi.useFakeTimers();
});

describe("ChannelStore", () => {
  it("should tell listeners, with a new revision, when a seed lands and after each change, not before", async () => {
    const { store, source, listener } = createStore();
    const first = defer(source.fetchMessages);
    const initial = store.revision;

    const messages = store.messages();
    store.apply({ t: "READY" });
    expect(listener).not.toHaveBeenCalled();
    first.resolve([message("1")]);
    await messages;
    expect(listener).toHaveBeenCalledOnce();

    store.apply(del("1"));
    expect(listener).toHaveBeenCalledTimes(2);
    const revisions = listener.mock.results.map((r) => r.value);
    expect(new Set([initial, ...revisions]).size).toBe(3);
  });

  it("should retry a failed first seed later, sooner after an event", async () => {
    const { store, source, listener } = createStore();
    source.fetchMessages.mockRejectedValueOnce(new Error("down"));
    await expect(store.messages()).rejects.toThrow("down");

    source.fetchMessages.mockRejectedValueOnce(new Error("down"));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(source.fetchMessages).toHaveBeenCalledTimes(2);

    // Events bring the 20s retry forward to 10s, and no further.
    for (let i = 0; i < 5; i++) {
      store.apply(create(message("2")));
      await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(listener).not.toHaveBeenCalled();
    expect(source.fetchMessages).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(source.fetchMessages).toHaveBeenCalledTimes(3);
    expect(listener).toHaveBeenCalledOnce();
    expect(await store.messages()).toMatchObject([{ id: "1" }]);
  });

  it("should seed on an event when nothing has asked yet", async () => {
    const { store, source, listener } = createStore();

    store.apply(create(message("2")));
    store.apply(create(message("3")));
    await vi.advanceTimersByTimeAsync(0);

    expect(source.fetchMessages).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledOnce();
  });

  it("should log a throwing listener and still tell the rest", async () => {
    const { store, listener } = createStore();
    store.listen(() => {
      throw new Error("boom");
    });

    await store.messages();

    expect(listener).toHaveBeenCalledOnce();
    expect(log.error).toHaveBeenCalledOnce();
  });

  it("should leave out messages the site doesn't show", async () => {
    const { store } = createStore([message("1"), message("2", { type: 7 })]);

    expect(await store.messages()).toMatchObject([{ id: "1" }]);
  });

  it("should seed again on a new session, forgetting what it may have missed", async () => {
    const { store, source } = await seeded([reacted("1")]);
    await reactors(store);
    await store.find("old");
    await store.memberName("user-2");
    source.fetchMessages.mockResolvedValueOnce([reacted("1"), message("2")]);

    store.apply({ t: "READY" });
    expect(await store.messages()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(await store.messages()).toHaveLength(2);

    await reactors(store);
    await store.find("old");
    await store.memberName("user-2");
    expect(source.fetchReactors).toHaveBeenCalledTimes(2);
    expect(source.fetchMessage).toHaveBeenCalledTimes(2);
    expect(source.fetchMemberName).toHaveBeenCalledTimes(2);
  });

  it("should not keep who reacted from a fetch that started before a gap", async () => {
    const { store, source } = await seeded([reacted("1")]);
    const fetch = defer(source.fetchReactors);
    source.fetchReactors.mockResolvedValue(users(["user-3"]));

    const reseed = defer(source.fetchMessages);

    const ids = reactors(store);
    store.apply({ t: "MISSED" });
    fetch.resolve(users(["user-2"]));
    await ids;
    reseed.resolve([reacted("1")]);
    await vi.advanceTimersByTimeAsync(0);

    expect(await reactors(store)).toEqual(["user-3"]);
  });

  it("should seed again when a new session starts mid-seed", async () => {
    const { store, source } = await seeded();
    const first = defer(source.fetchMessages);
    source.fetchMessages.mockResolvedValueOnce([message("1"), message("2")]);

    store.apply({ t: "READY" });
    store.apply({ t: "READY" });
    first.resolve([message("1")]);
    await vi.advanceTimersByTimeAsync(0);

    expect(await store.messages()).toHaveLength(2);
    expect(source.fetchMessages).toHaveBeenCalledTimes(3);
  });

  it("should give up seeding again after a few attempts and retry later", async () => {
    const { store, source } = createStore();
    source.fetchMessages.mockImplementation(churn(store));

    expect(await store.messages()).toHaveLength(1);
    expect(source.fetchMessages).toHaveBeenCalledTimes(3);
    expect(log.warn).toHaveBeenCalledOnce();

    source.fetchMessages.mockResolvedValue([message("1"), message("2")]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await store.messages()).toHaveLength(2);
  });

  it("should keep the live window when a refill gives up, but not after a gap", async () => {
    const { store, source } = await seeded([message("0"), message("1")]);
    source.fetchMessages.mockImplementation(async () => {
      store.apply(create(message("2")));
      return [message("1")];
    });

    store.apply(del("0"));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(source.fetchMessages).toHaveBeenCalledTimes(4);
    expect(await store.messages()).toMatchObject([{ id: "1" }, { id: "2" }]);

    store.apply(react("MESSAGE_REACTION_ADD", "user-2"));
    source.fetchReactors.mockResolvedValue(users(["user-2", "user-3"]));
    expect(await reactors(store)).toEqual(["user-2", "user-3"]);

    store.apply({ t: "READY" });
    await vi.advanceTimersByTimeAsync(0);
    expect(source.fetchMessages).toHaveBeenCalledTimes(7);
    expect(await store.messages()).toMatchObject([{ id: "1" }]);
  });

  it("should seed again after a failed or changing reseed until one lands", async () => {
    const { store, source, listener } = await seeded();

    source.fetchMessages.mockRejectedValueOnce(new Error("down"));
    store.apply({ t: "READY" });
    await vi.advanceTimersByTimeAsync(0);
    expect(log.error).toHaveBeenCalledWith(
      { err: new Error("down") },
      "Failed to seed the channel store",
    );
    expect(await store.messages()).toHaveLength(1);

    source.fetchMessages.mockImplementation(churn(store));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(log.warn).toHaveBeenCalledOnce();
    listener.mockClear();

    source.fetchMessages.mockResolvedValue([message("1"), message("2")]);
    const calls = source.fetchMessages.mock.calls.length;
    await store.messages();
    expect(source.fetchMessages).toHaveBeenCalledTimes(calls);
    // Each retry waits twice as long as the last.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(source.fetchMessages).toHaveBeenCalledTimes(calls);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await store.messages()).toHaveLength(2);
    expect(listener).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(source.fetchMessages).toHaveBeenCalledTimes(calls + 1);

    source.fetchMessages.mockRejectedValueOnce(new Error("down"));
    store.apply({ t: "MISSED" });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(source.fetchMessages).toHaveBeenCalledTimes(calls + 3);
  });

  it("should seed again after an event it couldn't read, keeping names", async () => {
    const { store, source } = await seeded();
    await store.memberName("user-2");
    source.fetchMessages.mockResolvedValueOnce([message("1"), message("2")]);

    store.apply({ t: "MISSED" });
    await vi.advanceTimersByTimeAsync(0);

    expect(await store.messages()).toHaveLength(2);
    await store.memberName("user-2");
    expect(source.fetchMemberName).toHaveBeenCalledOnce();
  });

  it("should not count a reaction twice when the seed already holds it", async () => {
    const { store, source } = await seeded([reacted("1", 2, true)]);
    source.fetchReactors.mockResolvedValue([
      { id: BOT, bot: true },
      { id: "user-3" },
    ]);
    await reactors(store);

    store.apply(react("MESSAGE_REACTION_ADD", BOT));
    store.apply(react("MESSAGE_REACTION_ADD", "user-2"));
    store.apply(react("MESSAGE_REACTION_ADD", "user-2"));

    expect(await reactionsOf(store)).toMatchObject([{ count: 3, me: true }]);
    store.apply(react("MESSAGE_REACTION_REMOVE", BOT));
    store.apply(react("MESSAGE_REACTION_REMOVE", BOT));
    store.apply(
      react("MESSAGE_REACTION_ADD", BOT, { emoji: { id: null, name: "👍" } }),
    );
    expect(await reactionsOf(store)).toMatchObject([
      { count: 2, me: false },
      { count: 1, me: true },
    ]);
  });

  it("should keep a name an event learned when an earlier lookup fails", async () => {
    const { store, source } = await seeded();
    const lookup = defer(source.fetchMemberName);

    const failed = store.memberName("user-2");
    store.apply(
      create(message("2", { author: { id: "user-2", username: "user2" } }), {
        nick: "Nick",
      }),
    );
    lookup.reject(new Error("down"));
    await expect(failed).rejects.toThrow("down");

    expect(await store.memberName("user-2")).toBe("Nick");
    expect(source.fetchMemberName).toHaveBeenCalledOnce();
  });

  it("should correct a count from who reacted once it's fetched", async () => {
    const { store, source, listener } = await seeded([
      reacted("1"),
      reacted("2"),
    ]);
    source.fetchReactors
      .mockResolvedValueOnce([{ id: "user-2" }])
      .mockResolvedValueOnce([]);

    store.apply(react("MESSAGE_REACTION_ADD", "user-2"));
    expect(await reactionsOf(store)).toMatchObject([{ count: 2 }]);
    listener.mockClear();

    expect(await reactors(store)).toEqual(["user-2"]);
    expect(await reactionsOf(store)).toMatchObject([{ count: 1 }]);
    expect(listener).toHaveBeenCalledOnce();

    expect(await reactors(store, "2")).toEqual([]);
    expect(await reactionsOf(store, "2")).toEqual([]);

    await reactors(store);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("should keep the seed's mirror flag while the bot's id is unknown", async () => {
    const { store, source, listener } = await seeded([reacted("1", 2, true)]);
    source.botUserId.mockReturnValue(null);
    source.fetchReactors.mockResolvedValue([
      { id: BOT, bot: true },
      { id: "user-2" },
    ]);

    expect(await reactors(store)).toEqual(["user-2"]);
    expect(await reactionsOf(store)).toMatchObject([{ count: 2, me: true }]);
    expect(listener).not.toHaveBeenCalled();
  });

  it("should keep a newer reactor fetch when an older one fails", async () => {
    const { store, source } = await seeded([reacted("1", 2)]);
    const first = defer(source.fetchReactors);
    const second = defer(source.fetchReactors);

    const failed = reactors(store);
    store.apply(react("MESSAGE_REACTION_REMOVE", "user-2"));
    const ids = reactors(store);
    first.reject(new Error("down"));
    await expect(failed).rejects.toThrow("down");
    const again = reactors(store);
    second.resolve(users(["user-3"]));

    expect(await ids).toEqual(["user-3"]);
    expect(await again).toEqual(["user-3"]);
    expect(source.fetchReactors).toHaveBeenCalledTimes(2);
  });

  it("should find older messages once and drop them when an event changes them", async () => {
    const { store, source } = await seeded();

    expect(await store.find("1")).toMatchObject({ id: "1" });
    expect(await store.find("old")).toMatchObject({ id: "old" });
    await store.find("old");
    expect(source.fetchMessage).toHaveBeenCalledOnce();

    store.apply(update("old", { content: "edited" }));
    await store.find("old");
    store.apply(del("old"));
    await store.find("old");
    store.apply(bulkDelete(["old"]));
    await store.find("old");
    expect(source.fetchMessage).toHaveBeenCalledTimes(4);
    expect(await stored(store, "old")).toBeUndefined();
  });

  it("should drop an older message when its reactions change", async () => {
    const { store, source } = await seeded();
    await store.find("old");

    for (const event of [
      react("MESSAGE_REACTION_ADD", "u1", { messageId: "old" }),
      react("MESSAGE_REACTION_REMOVE", "u1", { messageId: "old" }),
      clear("old", SMILE as Emoji),
      clear("old"),
    ]) {
      store.apply(event);
      await store.find("old");
    }

    expect(source.fetchMessage).toHaveBeenCalledTimes(5);
  });

  it("should fetch an older message again after a failure, keeping a newer fetch", async () => {
    const { store, source } = createStore();
    const first = defer(source.fetchMessage);

    const failed = store.find("old");
    store.apply(del("old"));
    expect(await store.find("old")).toMatchObject({ id: "old" });
    first.reject(new Error("down"));
    await expect(failed).rejects.toThrow("down");
    await store.find("old");
    expect(source.fetchMessage).toHaveBeenCalledTimes(2);

    store.apply(del("old"));
    source.fetchMessage.mockRejectedValueOnce(new Error("down"));
    await expect(store.find("old")).rejects.toThrow("down");
    expect(await store.find("old")).toMatchObject({ id: "old" });
  });

  it("should not keep who reacted to a message outside the window", async () => {
    const { store, source } = await seeded();
    source.fetchReactors.mockResolvedValue(users(["user-2"]));

    expect(await reactors(store, "old")).toEqual(["user-2"]);
    await reactors(store, "old");
    expect(source.fetchReactors).toHaveBeenCalledTimes(2);
  });

  it("should only drop the cleared message's reactor fetches", async () => {
    const { store, source } = await seeded([reacted("1"), reacted("2")]);
    source.fetchReactors.mockResolvedValue(users(["user-2"]));

    const ids = [reactors(store), reactors(store, "2")];
    store.apply(clear("1"));
    await Promise.all(ids);
    await reactors(store, "2");

    expect(source.fetchReactors).toHaveBeenCalledTimes(3);
  });

  it("should count and recount a reaction beside others, skipping a nameless reactor", async () => {
    const { store, source } = await seeded([
      message("1", {
        reactions: [
          { count: 1, me: false, emoji: { id: null, name: "👍" } },
          { count: 1, me: false, emoji: SMILE },
        ],
      }),
    ]);

    store.apply(
      react("MESSAGE_REACTION_ADD", "nameless", { member: { user: {} } }),
    );
    await store.memberName("nameless");

    expect(await reactionsOf(store)).toMatchObject([
      { count: 1 },
      { count: 2 },
    ]);
    expect(source.fetchMemberName).toHaveBeenCalledOnce();

    source.fetchReactors.mockResolvedValue(
      users(["user-2", "nameless", "user-4"]),
    );
    await reactors(store);
    expect(await reactionsOf(store)).toMatchObject([
      { count: 1 },
      { count: 3 },
    ]);
  });

  it("should hand back who reacted as an event settled it mid-fetch", async () => {
    const { store, source } = await seeded([reacted("1")]);
    const fetch = defer(source.fetchReactors);

    const ids = reactors(store);
    store.apply(react("MESSAGE_REACTION_REMOVE", "user-2"));
    store.apply(react("MESSAGE_REACTION_ADD", "user-3"));
    fetch.resolve(users(["user-2"]));

    expect(await ids).toEqual(["user-3"]);
  });

  it("should add, edit and delete messages", async () => {
    const { store } = await seeded();

    store.apply(create(message("2")));
    store.apply(update("1", { content: "edited" }));
    store.apply(create(message("3", { type: 7 })));

    expect(await store.messages()).toMatchObject([
      { id: "1", content: "edited" },
      { id: "2" },
    ]);

    store.apply(bulkDelete(["1", "2"]));
    expect(await store.messages()).toEqual([]);
  });

  it("should refill the window once after a burst of deletes", async () => {
    const { store, source } = await seeded([
      message("1"),
      message("2"),
      message("3"),
    ]);
    source.fetchMessages.mockResolvedValue([message("0"), message("3")]);

    store.apply(del("x"));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(source.fetchMessages).toHaveBeenCalledOnce();

    store.apply(del("1"));
    await vi.advanceTimersByTimeAsync(5_000);
    store.apply(del("2"));
    expect(await store.messages()).toMatchObject([{ id: "3" }]);
    expect(source.fetchMessages).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(5_000);
    expect(await store.messages()).toMatchObject([{ id: "0" }, { id: "3" }]);
    expect(source.fetchMessages).toHaveBeenCalledTimes(2);
  });

  it("should keep what it knows across a refill where the counts agree", async () => {
    const { store, source } = await seeded([
      reacted("1"),
      reacted("2"),
      message("3"),
    ]);
    source.fetchReactors.mockResolvedValue(users(["user-2"]));
    await reactors(store);
    await reactors(store, "2");
    await store.find("old");
    source.fetchMessages.mockResolvedValue([reacted("1"), reacted("2", 2)]);

    store.apply(del("3"));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(source.fetchMessages).toHaveBeenCalledTimes(2);

    await reactors(store);
    await reactors(store, "2");
    await store.find("old");
    expect(source.fetchReactors).toHaveBeenCalledTimes(3);
    expect(source.fetchMessage).toHaveBeenCalledOnce();
  });

  it("should keep a seeded copy over a late create and only take an edit's fields", async () => {
    const { store } = await seeded([reacted("1")]);

    store.apply(create(message("1")));
    store.apply(update("1", { type: 7, edited_timestamp: "later" }));

    expect(await stored(store, "1")).toMatchObject({
      type: 0,
      content: "User: Hi",
      edited_timestamp: "later",
      reactions: [{ count: 1 }],
    });
  });

  it("should keep only the latest messages", async () => {
    const { store } = await seeded(
      Array.from({ length: WINDOW }, (_, i) => message(`${i}`)),
    );

    store.apply(create(message("new")));

    const messages = await store.messages();
    expect(messages).toHaveLength(WINDOW);
    expect(messages[0]?.id).toBe("1");
    expect(messages.at(-1)?.id).toBe("new");
  });

  it("should count reactions, track the bot's mirror and drop who takes theirs back", async () => {
    const { store } = await seeded();

    store.apply(react("MESSAGE_REACTION_ADD", "user-2"));
    store.apply(react("MESSAGE_REACTION_ADD", "user-3"));
    store.apply(react("MESSAGE_REACTION_ADD", BOT));
    expect(await reactionsOf(store)).toEqual([
      { count: 3, me: true, emoji: SMILE },
    ]);
    expect(await reactors(store)).toEqual(["user-2", "user-3"]);

    store.apply(react("MESSAGE_REACTION_REMOVE", BOT));
    store.apply(react("MESSAGE_REACTION_REMOVE", "user-2"));
    expect(await reactionsOf(store)).toEqual([
      { count: 1, me: false, emoji: SMILE },
    ]);
    expect(await reactors(store)).toEqual(["user-3"]);

    store.apply(react("MESSAGE_REACTION_REMOVE", "user-3"));
    expect(await reactionsOf(store)).toEqual([]);
  });

  it("should share one fetch of who reacted, and skip it for a deleted message", async () => {
    const { store, source } = await seeded([reacted("1")]);
    const fetch = defer(source.fetchReactors);

    const first = reactors(store);
    const second = reactors(store);
    store.apply(del("1"));
    fetch.resolve(users(["user-2"]));

    expect(await first).toEqual(["user-2"]);
    expect(await second).toEqual(["user-2"]);
    expect(source.fetchReactors).toHaveBeenCalledOnce();
  });

  it("should fetch who reacted again after a failure", async () => {
    const { store, source } = await seeded([reacted("1")]);
    source.fetchReactors
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValue(users(["user-2"]));

    await expect(reactors(store)).rejects.toThrow("down");
    expect(await reactors(store)).toEqual(["user-2"]);
  });

  it("should not learn names from the bot's posts or nameless authors", async () => {
    const { store, source } = await seeded();

    store.apply(
      create(message("2", { author: { id: BOT, bot: true, username: "b" } }), {
        nick: "Bot",
      }),
    );
    store.apply(create(message("3", { author: { id: "user-4" } }), {}));

    await store.memberName(BOT);
    await store.memberName("user-4");
    expect(source.fetchMemberName).toHaveBeenCalledTimes(2);
  });

  it("should leave other bots out of who reacted, as REST does", async () => {
    const { store } = await seeded();

    store.apply(
      react("MESSAGE_REACTION_ADD", "other-bot", {
        member: { user: { bot: true, username: "b" } },
      }),
    );

    expect(await reactionsOf(store)).toMatchObject([{ count: 1 }]);
    expect(await reactors(store)).toEqual([]);
  });

  it("should fetch who reacted when a reaction comes without member data", async () => {
    const { store, source } = await seeded();
    source.fetchReactors.mockResolvedValue(users(["user-2"]));

    store.apply(react("MESSAGE_REACTION_ADD", "user-2"));
    store.apply(react("MESSAGE_REACTION_ADD", "maybe-bot", { member: null }));

    expect(await reactionsOf(store)).toMatchObject([{ count: 2 }]);
    expect(await reactors(store)).toEqual(["user-2"]);
    expect(source.fetchReactors).toHaveBeenCalledOnce();
  });

  it("should keep a looked-up name over an event without member data", async () => {
    const { store, source } = await seeded();
    await store.memberName("user-2");

    store.apply(
      create(message("2", { author: { id: "user-2", username: "two" } })),
    );

    expect(await store.memberName("user-2")).toBe("member user-2");
    expect(source.fetchMemberName).toHaveBeenCalledOnce();
  });

  it("should ignore, without telling listeners, custom emoji, unchanged messages and events outside the window", async () => {
    const { store, listener } = await seeded();

    store.apply(
      react("MESSAGE_REACTION_ADD", "user-2", {
        emoji: { id: "9", name: "x" },
      }),
    );
    store.apply(react("MESSAGE_REACTION_ADD", "user-2", { messageId: "old" }));
    store.apply(react("MESSAGE_REACTION_REMOVE", "user-2"));
    store.apply(clear("old"));
    store.apply(clear("1", { id: "9", name: null }));
    store.apply(update("old", { content: "edited" }));
    store.apply(update("1"));
    store.apply(create(message("1")));
    store.apply(create(message("2", { type: 7 })));
    store.apply(del("old"));
    store.apply(clear("1"));
    store.apply(clear("1", SMILE));

    expect(await store.messages()).toEqual([message("1")]);
    expect(listener).not.toHaveBeenCalled();
  });

  it("should fetch who reacted to a seeded reaction once, then follow events", async () => {
    const { store, source } = await seeded([reacted("1")]);
    source.fetchReactors.mockResolvedValue(users(["user-2"]));

    expect(await reactors(store)).toEqual(["user-2"]);
    store.apply(react("MESSAGE_REACTION_ADD", "user-3"));
    expect(await reactors(store)).toEqual(["user-2", "user-3"]);
    expect(source.fetchReactors).toHaveBeenCalledOnce();
  });

  it("should keep the first fetch's reactors when fetching again fails", async () => {
    const { store, source } = await seeded([reacted("1")]);
    const first = defer(source.fetchReactors);
    source.fetchReactors.mockRejectedValueOnce(new Error("down"));

    const ids = reactors(store);
    store.apply(react("MESSAGE_REACTION_ADD", "user-3"));
    first.resolve(users(["user-2"]));

    expect(await ids).toEqual(["user-2"]);
  });

  it("should fetch who reacted to a new reaction while the window may have missed events", async () => {
    const { store, source } = createStore();
    source.fetchMessages.mockImplementation(churn(store));
    source.fetchReactors.mockResolvedValue(users(["user-2", "user-3"]));
    await store.messages();

    store.apply(react("MESSAGE_REACTION_ADD", "user-3"));

    expect(await reactors(store)).toEqual(["user-2", "user-3"]);
  });

  it("should fetch who reacted again when an event makes a fetch stale", async () => {
    const { store, source } = await seeded([reacted("1")]);
    const first = defer(source.fetchReactors);
    source.fetchReactors.mockResolvedValue(users(["user-2", "user-3"]));

    const stale = reactors(store);
    store.apply(react("MESSAGE_REACTION_ADD", "user-3"));
    first.resolve(users(["user-2"]));

    expect(await stale).toEqual(["user-2", "user-3"]);
    expect(await reactors(store)).toEqual(["user-2", "user-3"]);
    expect(source.fetchReactors).toHaveBeenCalledTimes(2);
  });

  it("should clear reactions by message and by emoji", async () => {
    const { store } = await seeded();
    store.apply(react("MESSAGE_REACTION_ADD", "user-2"));
    store.apply(
      react("MESSAGE_REACTION_ADD", "user-2", {
        emoji: { id: null, name: "🎉" },
      }),
    );

    store.apply(clear("1", SMILE));
    expect(await reactionsOf(store)).toMatchObject([{ emoji: { name: "🎉" } }]);

    store.apply(clear("1"));
    expect(await reactionsOf(store)).toEqual([]);
  });

  it("should learn names from events instead of asking", async () => {
    const { store, source } = await seeded();

    store.apply(
      create(message("2", { author: { id: "user-2", global_name: "Two" } }), {
        nick: "Nick",
      }),
    );
    store.apply(
      react("MESSAGE_REACTION_ADD", "user-3", {
        member: { nick: null, user: { username: "three" } },
      }),
    );

    expect(await store.memberName("user-2")).toBe("Nick");
    expect(await store.memberName("user-3")).toBe("three");
    expect(source.fetchMemberName).not.toHaveBeenCalled();
  });

  it("should ask for a name once, and again only after a failure", async () => {
    const { store, source } = createStore();
    source.fetchMemberName.mockRejectedValueOnce(new Error("down"));

    await expect(store.memberName("user-2")).rejects.toThrow("down");
    expect(await store.memberName("user-2")).toBe("member user-2");
    expect(await store.memberName("user-2")).toBe("member user-2");
    expect(source.fetchMemberName).toHaveBeenCalledTimes(2);
  });
});
