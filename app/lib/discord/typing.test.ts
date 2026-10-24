// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import { log } from "@/lib/log";
import { message } from "@/mocks/discord";
import { mockEnv } from "@/mocks/env";

import { type EventSubscriber, subscribe } from "./gateway";
import type { TypingStart } from "./schemas";
import { subscribeToTyping } from "./typing";

vi.mock(import("./gateway"), () => ({
  subscribe: vi.fn(() => Promise.resolve(() => {})),
  getBotUserId: () => "bot",
}));

const CHANNEL = mockEnv.DISCORD_CHANNEL_ID;
const simon = {
  user_id: "simon",
  member: { nick: "simon", user: { username: "simonkberg" } },
};
const bot = {
  user_id: "bot",
  member: { user: { username: "simon.dev", bot: true } },
};
const otherBot = {
  user_id: "other-bot",
  member: { user: { username: "other-bot", bot: true } },
};
const memberless = { user_id: "someone" };

function listen() {
  const listener = vi.fn();
  subscribeToTyping(listener);
  const dispatch: EventSubscriber = vi.mocked(subscribe).mock.calls[0]![0];
  return { listener, dispatch };
}

const typing = (typist: Omit<TypingStart, "channel_id">) =>
  ({ t: "TYPING_START", d: { channel_id: CHANNEL, ...typist } }) as const;

describe("subscribeToTyping", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("tells who is typing, by chat name, until Discord's indicator runs out", async () => {
    const { listener, dispatch } = listen();

    dispatch(typing(simon));
    dispatch(typing(bot));
    expect(listener.mock.calls).toEqual([
      [[]],
      [["simon"]],
      [["simon", "simon-bot"]],
    ]);

    await vi.advanceTimersByTimeAsync(9_000);
    dispatch(typing(simon));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(listener).toHaveBeenLastCalledWith(["simon"]);
    expect(listener).toHaveBeenCalledTimes(4);

    await vi.advanceTimersByTimeAsync(9_000);
    expect(listener).toHaveBeenLastCalledWith([]);
  });

  it("stops a typist when they post, and only them", () => {
    const { listener, dispatch } = listen();
    dispatch(typing(simon));
    dispatch(typing(bot));

    dispatch({
      t: "MESSAGE_CREATE",
      d: message("0", { author: { id: "nameless" } }),
    });
    dispatch({
      t: "MESSAGE_CREATE",
      d: message("1", {
        author: { id: "bot", bot: true },
        content: "brave-otter: hi",
      }),
    });
    expect(listener).toHaveBeenLastCalledWith(["simon", "simon-bot"]);

    dispatch({
      t: "MESSAGE_CREATE",
      d: message("2", {
        author: { id: "bot", bot: true },
        content: "simon-bot: hello",
      }),
    });
    expect(listener).toHaveBeenLastCalledWith(["simon"]);

    dispatch({
      t: "MESSAGE_CREATE",
      d: { ...message("3", { author: { id: "simon" } }), member: simon.member },
    });
    expect(listener).toHaveBeenLastCalledWith([]);
  });

  it("leaves out typing it can't name, and keeps another bot's own name", () => {
    const { listener, dispatch } = listen();

    dispatch(typing(memberless));
    dispatch(typing(otherBot));

    expect(listener).toHaveBeenLastCalledWith(["other-bot"]);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("logs when it can't hear the gateway", async () => {
    vi.mocked(subscribe).mockRejectedValue(new Error("fatal"));

    subscribeToTyping(vi.fn());
    await vi.advanceTimersByTimeAsync(0);

    expect(log.error).toHaveBeenCalledWith(
      { err: new Error("fatal") },
      "Typing failed to subscribe to the gateway",
    );
  });
});
