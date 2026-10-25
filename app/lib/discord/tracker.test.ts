// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { log } from "@/lib/log";
import { gatewayDispatcher as dispatcher } from "@/mocks/gateway";

import { subscribe } from "./gateway";
import { gatewayTracker } from "./tracker";

vi.mock(import("./gateway"), () => ({
  subscribe: vi.fn(() => Promise.resolve(() => {})),
}));

// Names each event, so a test can tell what it heard.
const tracker = () =>
  gatewayTracker("test", (): string[] => [], {
    apply: (heard, event, publish) => {
      heard.push(event.t);
      publish();
    },
    names: (heard) => [...heard],
  });

describe("gatewayTracker", () => {
  it("tells a listener the names now and on every change", () => {
    const { subscribe: listen } = tracker();
    const listener = vi.fn();

    listen(listener);
    dispatcher()({ t: "READY" });

    expect(listener.mock.calls).toEqual([[[]], [["READY"]]]);
  });

  it("hears the gateway from when it starts, once", () => {
    const { start, subscribe: listen } = tracker();
    start();
    dispatcher()({ t: "READY" });

    const listener = vi.fn();
    listen(listener);

    expect(listener).toHaveBeenCalledExactlyOnceWith(["READY"]);
    expect(subscribe).toHaveBeenCalledOnce();
  });

  it("stops telling a listener that left", () => {
    const listener = vi.fn();
    tracker().subscribe(listener)();

    dispatcher()({ t: "READY" });

    expect(listener).toHaveBeenCalledOnce();
  });

  it("logs when it can't hear the gateway", async () => {
    vi.mocked(subscribe).mockRejectedValue(new Error("fatal"));

    tracker().start();
    await vi.waitFor(() =>
      expect(log.error).toHaveBeenCalledWith(
        { err: new Error("fatal"), tracker: "test" },
        "Tracker failed to subscribe to the gateway",
      ),
    );
  });
});
