import "server-only";
import { getGlobal } from "@/lib/global";
import { log } from "@/lib/log";

import { memberName } from "./api";
import { type GatewayEvent, getBotUserId, subscribe } from "./gateway";
import { displayName } from "./schemas";

// Idle reads as away, and invisible arrives as offline.
const HERE = new Set(["online", "dnd"]);

type Listener = (online: readonly string[]) => void;

type Online = {
  names: Map<string, string | undefined>;
  bots: Set<string>;
  online: Set<string>;
  listeners: Set<Listener>;
};

const named = (state: Online) =>
  [...state.online].flatMap((id) => state.names.get(id) ?? []);

function publish(state: Online): void {
  const online = named(state);
  for (const listener of state.listeners) listener(online);
}

// GUILD_MEMBER_ADD needs yet another privileged intent, so a member who joined since is asked for.
function learnName(state: Online, id: string): void {
  memberName(id)
    .then((name) => {
      state.names.set(id, name);
      publish(state);
    })
    .catch((err: unknown) => {
      log.warn({ err }, "Failed to name an online member");
    });
}

function apply(state: Online, event: GatewayEvent): void {
  switch (event.t) {
    case "GUILD_CREATE": {
      const { members, presences } = event.d;
      state.names = new Map(
        members.map(({ user, ...member }) => [
          user.id,
          displayName(user, member),
        ]),
      );
      state.bots = new Set(
        members.flatMap(({ user }) => (user.bot ? [user.id] : [])),
      );
      state.online = new Set();
      for (const presence of presences) set(state, presence);
      publish(state);
      return;
    }
    case "PRESENCE_UPDATE": {
      const was = state.online.has(event.d.user.id);
      set(state, event.d);
      if (state.online.has(event.d.user.id) !== was) publish(state);
    }
  }
}

function set(
  state: Online,
  { user, status }: { user: { id: string; bot?: boolean }; status: string },
): void {
  // simon-bot is the site's own, shown apart from who is here.
  if (user.bot || state.bots.has(user.id) || user.id === getBotUserId()) {
    return;
  }
  if (!HERE.has(status)) {
    state.online.delete(user.id);
    return;
  }
  state.online.add(user.id);
  if (!state.names.has(user.id)) learnName(state, user.id);
}

// Every replica hears Discord, so who is online needs no shared state.
const online = () =>
  getGlobal<Online>("online", () => {
    const state: Online = {
      names: new Map(),
      bots: new Set(),
      online: new Set(),
      listeners: new Set(),
    };
    subscribe((event) => apply(state, event)).catch((err: unknown) => {
      log.error({ err }, "Online failed to subscribe to the gateway");
    });
    return state;
  });

/** Tells `listener` who is online in Discord now and on every change, by chat name. */
export function subscribeToOnline(listener: Listener): () => void {
  const state = online();
  state.listeners.add(listener);
  listener(named(state));
  return () => state.listeners.delete(listener);
}
