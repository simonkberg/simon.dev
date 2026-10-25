import { vi } from "vitest";

import { type EventSubscriber, subscribe } from "@/lib/discord/gateway";

/** The listener the code under test gave the mocked gateway's first `subscribe`, to feed it events. */
export function gatewayDispatcher(): EventSubscriber {
  const dispatch = vi.mocked(subscribe).mock.calls[0]?.[0];
  if (!dispatch) throw new Error("Nothing subscribed to the gateway");
  return dispatch;
}
