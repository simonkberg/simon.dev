// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import { log } from "@/lib/log";
import { mockEnv } from "@/mocks/env";

import { memberName } from "./api";
import { type EventSubscriber, subscribe } from "./gateway";
import { subscribeToOnline, watchOnline } from "./online";
import type { GuildCreate } from "./schemas";

vi.mock(import("./gateway"), () => ({
  subscribe: vi.fn(() => Promise.resolve(() => {})),
  getBotUserId: () => "bot",
}));

vi.mock(import("./api"), () => ({
  memberName: vi.fn(() => Promise.resolve("newcomer")),
}));

const GUILD = mockEnv.DISCORD_GUILD_ID;

const members: GuildCreate["members"] = [
  { nick: "simon", user: { id: "simon", username: "simonkberg" } },
  { user: { id: "alice", username: "alice" } },
  { user: { id: "bot", username: "simon.dev", bot: true } },
  { user: { id: "other-bot", username: "other-bot", bot: true } },
];

function listen() {
  const listener = vi.fn();
  subscribeToOnline(listener);
  const dispatch: EventSubscriber = vi.mocked(subscribe).mock.calls[0]![0];
  return { listener, dispatch };
}

const guild = (presences: GuildCreate["presences"]) =>
  ({ t: "GUILD_CREATE", d: { id: GUILD, members, presences } }) as const;

const presence = (id: string, status: string, bot?: boolean) =>
  ({
    t: "PRESENCE_UPDATE",
    d: { guild_id: GUILD, user: { id, bot }, status },
  }) as const;

describe("subscribeToOnline", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("tells who is in Discord, by chat name, leaving out bots and the idle", () => {
    const { listener, dispatch } = listen();

    dispatch(
      guild([
        { user: { id: "simon" }, status: "online" },
        { user: { id: "alice" }, status: "idle" },
        { user: { id: "bot" }, status: "online" },
        { user: { id: "other-bot" }, status: "online" },
      ]),
    );

    expect(listener.mock.calls).toEqual([[[]], [["simon"]]]);
  });

  it("follows presence updates, and only tells of a change", () => {
    const { listener, dispatch } = listen();
    dispatch(guild([{ user: { id: "simon" }, status: "online" }]));

    dispatch(presence("simon", "dnd"));
    dispatch(presence("alice", "online"));
    expect(listener).toHaveBeenLastCalledWith(["simon", "alice"]);
    dispatch(presence("simon", "offline"));
    dispatch(presence("unknown-bot", "online", true));

    expect(listener).toHaveBeenLastCalledWith(["alice"]);
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it("asks Discord for the name of a member who joined since", async () => {
    const { listener, dispatch } = listen();
    dispatch(guild([]));

    dispatch(presence("newcomer-id", "online"));
    expect(listener).toHaveBeenLastCalledWith([]);
    await vi.advanceTimersByTimeAsync(0);

    expect(memberName).toHaveBeenCalledExactlyOnceWith("newcomer-id");
    expect(listener).toHaveBeenLastCalledWith(["newcomer"]);
  });

  it("logs when it can't name a member, and leaves them out", async () => {
    vi.mocked(memberName).mockRejectedValue(new Error("boom"));
    const { listener, dispatch } = listen();

    dispatch(presence("newcomer-id", "online"));
    await vi.advanceTimersByTimeAsync(0);

    expect(listener).toHaveBeenLastCalledWith([]);
    expect(log.warn).toHaveBeenCalledWith(
      { err: new Error("boom") },
      "Failed to name an online member",
    );
  });

  it("tells a later listener who was online when watching started", () => {
    watchOnline();
    const dispatch: EventSubscriber = vi.mocked(subscribe).mock.calls[0]![0];
    dispatch(guild([{ user: { id: "simon" }, status: "online" }]));

    const listener = vi.fn();
    subscribeToOnline(listener);

    expect(listener).toHaveBeenCalledWith(["simon"]);
    expect(subscribe).toHaveBeenCalledOnce();
  });

  it("stops telling a listener that left", () => {
    const listener = vi.fn();
    subscribeToOnline(listener)();
    const dispatch: EventSubscriber = vi.mocked(subscribe).mock.calls[0]![0];

    dispatch(presence("simon", "online"));

    expect(listener).toHaveBeenCalledOnce();
  });

  it("logs when it can't hear the gateway", async () => {
    vi.mocked(subscribe).mockRejectedValue(new Error("fatal"));

    subscribeToOnline(vi.fn());
    await vi.advanceTimersByTimeAsync(0);

    expect(log.error).toHaveBeenCalledWith(
      { err: new Error("fatal") },
      "Online failed to subscribe to the gateway",
    );
  });
});
