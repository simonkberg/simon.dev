import "server-only";
import { BOT_USERNAME } from "@/lib/anthropic";
import { getGlobal } from "@/lib/global";
import { log } from "@/lib/log";

import { type GatewayEvent, getBotUserId, subscribe } from "./gateway";
import { displayName, sitePost } from "./schemas";

// Discord's own indicator lasts this long, or until the typist posts.
const TYPING_MS = 10_000;

type Listener = (typing: readonly string[]) => void;

type Typing = {
  // Typist to the timer that ends their typing.
  typists: Map<string, NodeJS.Timeout>;
  listeners: Set<Listener>;
};

function publish(state: Typing): void {
  const typing = [...state.typists.keys()];
  for (const listener of state.listeners) listener(typing);
}

function stop(state: Typing, name: string): void {
  clearTimeout(state.typists.get(name));
  if (state.typists.delete(name)) publish(state);
}

// Keyed by name rather than Discord user, since the bot posts for every site visitor too.
function apply(state: Typing, event: GatewayEvent): void {
  switch (event.t) {
    case "TYPING_START": {
      const { user_id, member } = event.d;
      // The bot only types while simon-bot composes a reply.
      const name =
        user_id === getBotUserId()
          ? BOT_USERNAME
          : member && displayName(member.user, member);
      if (!name) return;
      const started = !state.typists.has(name);
      clearTimeout(state.typists.get(name));
      state.typists.set(
        name,
        setTimeout(() => stop(state, name), TYPING_MS).unref(),
      );
      if (started) publish(state);
      return;
    }
    case "MESSAGE_CREATE": {
      const { member, ...message } = event.d;
      const name =
        sitePost(message)?.username ?? displayName(message.author, member);
      if (name) stop(state, name);
    }
  }
}

// Every replica hears Discord, so typing needs no shared state.
const typing = () =>
  getGlobal<Typing>("typing", () => {
    const state: Typing = { typists: new Map(), listeners: new Set() };
    subscribe((event) => apply(state, event)).catch((err: unknown) => {
      log.error({ err }, "Typing failed to subscribe to the gateway");
    });
    return state;
  });

/** Tells `listener` who is typing in Discord now and on every change, by chat name. */
export function subscribeToTyping(listener: Listener): () => void {
  const state = typing();
  state.listeners.add(listener);
  listener([...state.typists.keys()]);
  return () => state.listeners.delete(listener);
}
