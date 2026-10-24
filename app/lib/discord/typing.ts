import "server-only";
import { BOT_USERNAME } from "@/lib/anthropic";

import { type GatewayEvent, getBotUserId } from "./gateway";
import { displayName, sitePost } from "./schemas";
import { gatewayTracker } from "./tracker";

// Discord's own indicator lasts this long, or until the typist posts.
const TYPING_MS = 10_000;

type Typing = Map<string, NodeJS.Timeout>;

function stop(timers: Typing, name: string, publish: () => void): void {
  clearTimeout(timers.get(name));
  if (timers.delete(name)) publish();
}

// Keyed by name rather than Discord user, since the bot posts for every site visitor too.
function apply(timers: Typing, event: GatewayEvent, publish: () => void): void {
  switch (event.t) {
    case "TYPING_START": {
      const { user_id, member } = event.d;
      // The bot only types while simon-bot composes a reply.
      const name =
        user_id === getBotUserId()
          ? BOT_USERNAME
          : member && displayName(member.user, member);
      if (!name) return;
      const started = !timers.has(name);
      clearTimeout(timers.get(name));
      timers.set(
        name,
        setTimeout(() => stop(timers, name, publish), TYPING_MS).unref(),
      );
      if (started) publish();
      return;
    }
    case "MESSAGE_CREATE": {
      const { member, ...message } = event.d;
      const name =
        sitePost(message)?.username ?? displayName(message.author, member);
      if (name) stop(timers, name, publish);
    }
  }
}

const typing = gatewayTracker("typing", (): Typing => new Map(), {
  apply,
  names: (timers) => [...timers.keys()],
});

/** Tells `listener` who is typing in Discord now and on every change, by chat name. */
export const subscribeToTyping = typing.subscribe;
