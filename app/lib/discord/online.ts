import "server-only";
import { log } from "@/lib/log";

import { memberName } from "./api";
import type { GatewayEvent } from "./gateway";
import { displayName, type Presence } from "./schemas";
import { gatewayTracker } from "./tracker";

// Idle reads as away, and invisible arrives as offline.
const HERE = new Set(["online", "dnd"]);

type Online = {
  names: Map<string, string | undefined>;
  bots: Set<string>;
  online: Set<string>;
};

// GUILD_MEMBER_ADD needs yet another privileged intent, so a member who joined since is asked for, once.
function learnName(state: Online, id: string, publish: () => void): void {
  state.names.set(id, undefined);
  memberName(id)
    .then((name) => {
      state.names.set(id, name);
      if (name && state.online.has(id)) publish();
    })
    .catch((err: unknown) => {
      log.warn({ err }, "Failed to name an online member");
      // So their next update asks again.
      if (state.names.get(id) === undefined) state.names.delete(id);
    });
}

function apply(state: Online, event: GatewayEvent, publish: () => void): void {
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
      for (const presence of presences) set(state, presence, publish);
      publish();
      return;
    }
    case "PRESENCE_UPDATE": {
      const was = state.online.has(event.d.user.id);
      set(state, event.d, publish);
      if (state.online.has(event.d.user.id) !== was) publish();
    }
  }
}

function set(
  state: Online,
  { user, status }: Presence,
  publish: () => void,
): void {
  // simon-bot among them, which the site shows apart from who is here.
  if (user.bot || state.bots.has(user.id)) return;
  if (!HERE.has(status)) {
    state.online.delete(user.id);
    return;
  }
  state.online.add(user.id);
  if (!state.names.has(user.id)) learnName(state, user.id, publish);
}

const online = gatewayTracker(
  "online",
  (): Online => ({ names: new Map(), bots: new Set(), online: new Set() }),
  {
    apply,
    names: (state) =>
      [...state.online].flatMap((id) => state.names.get(id) ?? []),
  },
);

/** Starts following who is online. Discord says so only as a session starts, so start it before the gateway connects. */
export const watchOnline = online.start;

/** Tells `listener` who is online in Discord now and on every change, by chat name. */
export const subscribeToOnline = online.subscribe;
