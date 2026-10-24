import "server-only";
import { getGlobal } from "@/lib/global";
import { log } from "@/lib/log";

import { type GatewayEvent, subscribe } from "./gateway";

type Listener = (names: readonly string[]) => void;

type Tracker<S> = {
  /** Folds an event into the state, calling `publish` when the names change. */
  apply: (state: S, event: GatewayEvent, publish: () => void) => void;
  names: (state: S) => readonly string[];
};

/**
 * Names kept from the gateway on each replica, since every replica hears Discord.
 * Returns a `subscribe` that tells a listener the names now and on every change, and a
 * `start` for a tracker that must hear the gateway from its first event.
 */
export function gatewayTracker<S>(
  key: string,
  init: () => S,
  { apply, names }: Tracker<S>,
) {
  const tracked = () =>
    getGlobal(key, () => {
      const state = init();
      const listeners = new Set<Listener>();
      const publish = () => {
        const now = names(state);
        for (const listener of listeners) listener(now);
      };
      subscribe((event) => apply(state, event, publish)).catch(
        (err: unknown) => {
          log.error(
            { err, tracker: key },
            "Tracker failed to subscribe to the gateway",
          );
        },
      );
      return { state, listeners };
    });

  return {
    start: (): void => {
      tracked();
    },
    subscribe: (listener: Listener): (() => void) => {
      const { state, listeners } = tracked();
      listeners.add(listener);
      listener(names(state));
      return () => listeners.delete(listener);
    },
  };
}
