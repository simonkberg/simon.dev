// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import { log } from "@/lib/log";
import { mockEnv } from "@/mocks/env";
import { gatewayDispatcher } from "@/mocks/gateway";

import { memberName } from "./api";
import { subscribeToOnline } from "./online";
import type { GuildCreate } from "./schemas";

vi.mock(import("./gateway"), () => ({
  subscribe: vi.fn(() => Promise.resolve(() => {})),
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
  return { listener, dispatch: gatewayDispatcher() };
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

  it("doesn't tell of a name that arrives after its member left", async () => {
    const { listener, dispatch } = listen();

    dispatch(presence("newcomer-id", "online"));
    dispatch(presence("newcomer-id", "offline"));
    const told = listener.mock.calls.length;
    await vi.advanceTimersByTimeAsync(0);

    expect(listener).toHaveBeenCalledTimes(told);
  });

  it("logs when it can't name a member, and asks again on their next update", async () => {
    vi.mocked(memberName).mockRejectedValueOnce(new Error("boom"));
    const { listener, dispatch } = listen();

    dispatch(presence("newcomer-id", "online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(listener).toHaveBeenLastCalledWith([]);
    expect(log.warn).toHaveBeenCalledWith(
      { err: new Error("boom") },
      "Failed to name an online member",
    );

    dispatch(presence("newcomer-id", "dnd"));
    await vi.advanceTimersByTimeAsync(0);
    expect(memberName).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith(["newcomer"]);
  });
});
