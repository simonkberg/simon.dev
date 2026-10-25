import { act, render, screen } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { dwell } from "@/mocks/popover";

import { ChatStream } from "./ChatStream";

vi.mock(import("next/navigation"), () => ({ useRouter: vi.fn() }));
const refresh = vi.fn();

function createMockEventSource() {
  const instances: MockEventSource[] = [];

  class MockEventSource extends EventTarget {
    onopen: () => void = () => {};
    onmessage: () => void = () => {};
    onerror: () => void = () => {};
    close = vi.fn();

    constructor() {
      super();
      instances.push(this);
    }

    sendStatus(data: string) {
      this.dispatchEvent(new MessageEvent("status", { data }));
    }

    sendPresence(here: string[]) {
      this.dispatchEvent(
        new MessageEvent("presence", { data: JSON.stringify(here) }),
      );
    }

    sendTyping(typing: string[]) {
      this.dispatchEvent(
        new MessageEvent("typing", { data: JSON.stringify(typing) }),
      );
    }
  }

  return {
    MockEventSource,
    instances,
    getInstance(this: void) {
      const instance = instances.at(-1);
      if (!instance) throw new Error("No EventSource instance available");
      return instance;
    },
  };
}

const status = () => screen.getByRole("status");

describe("ChatStream", () => {
  let mockEventSource: ReturnType<typeof createMockEventSource>;
  const instance = () => mockEventSource.getInstance();

  const renderStream = () => {
    const view = render(<ChatStream />);
    return { ...view, initialCount: mockEventSource.instances.length };
  };

  beforeEach(() => {
    vi.mocked(useRouter, { partial: true }).mockReturnValue({ refresh });
    vi.useFakeTimers();
    mockEventSource = createMockEventSource();
    vi.stubGlobal("EventSource", mockEventSource.MockEventSource);
  });

  describe("status", () => {
    it("is connecting until the stream opens, then live", () => {
      renderStream();

      expect(status()).toHaveTextContent("connecting");

      act(() => instance().onopen());

      expect(status()).toHaveTextContent("live");
      expect(status()).toHaveAttribute("data-status", "live");
    });

    it("follows the server's gateway status", () => {
      renderStream();
      act(() => instance().onopen());

      act(() => instance().sendStatus("connecting"));
      expect(status()).toHaveTextContent("connecting");

      act(() => instance().sendStatus("live"));
      expect(status()).toHaveTextContent("live");
    });

    it("is connecting while it waits to reconnect", () => {
      renderStream();
      act(() => instance().onopen());

      act(() => instance().onerror());

      expect(status()).toHaveTextContent("connecting");
    });

    it("is offline without a network, and reconnects and refreshes when it's back", () => {
      const onLine = vi
        .spyOn(navigator, "onLine", "get")
        .mockReturnValue(false);
      const { initialCount } = renderStream();
      const { instances } = mockEventSource;

      act(() => instance().onopen());
      act(() => instance().onerror());
      expect(status()).toHaveTextContent("offline");

      act(() => {
        vi.advanceTimersByTime(30_000);
      });
      expect(instances).toHaveLength(initialCount);

      onLine.mockReturnValue(true);
      act(() => {
        window.dispatchEvent(new Event("online"));
      });
      expect(status()).toHaveTextContent("connecting");
      expect(instances).toHaveLength(initialCount + 1);

      act(() => instance().onopen());
      expect(refresh).toHaveBeenCalledOnce();
    });

    it("goes offline and closes the stream when the network drops", () => {
      renderStream();
      const open = instance();
      act(() => open.onopen());

      act(() => {
        window.dispatchEvent(new Event("offline"));
      });

      expect(status()).toHaveTextContent("offline");
      expect(open.close).toHaveBeenCalled();
    });
  });

  describe("presence", () => {
    it("shows how many are here while live, and simon-bot by name", async () => {
      renderStream();
      act(() => instance().onopen());

      act(() => instance().sendPresence(["alice", "bob"]));
      expect(screen.getByText("2 here")).toBeInTheDocument();
      await dwell(screen.getByText("2 here"));
      expect(screen.getByRole("tooltip", { hidden: true })).toHaveTextContent(
        "alice, bob, and simon-bot",
      );

      act(() => instance().sendStatus("connecting"));
      expect(screen.queryByText("2 here")).not.toBeInTheDocument();
    });
  });

  describe("typing", () => {
    it("shows who is typing until the stream drops", () => {
      renderStream();
      act(() => instance().onopen());

      act(() => instance().sendTyping(["simon", "simon-bot"]));
      expect(
        screen.getByText("simon and simon-bot are typing…"),
      ).toBeInTheDocument();
      act(() => instance().sendTyping(["simon"]));
      expect(screen.getByText("simon is typing…")).toBeInTheDocument();

      act(() => instance().onerror());
      expect(screen.queryByText(/typing…/)).not.toBeInTheDocument();
    });
  });

  describe("connection", () => {
    it("refreshes the history when an SSE message is received", () => {
      renderStream();

      act(() => instance().onmessage());

      expect(refresh).toHaveBeenCalledOnce();
    });

    it("refreshes the history when it reconnects, not when it first opens", () => {
      renderStream();

      act(() => instance().onopen());
      expect(refresh).not.toHaveBeenCalled();

      act(() => instance().onerror());
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      act(() => instance().onopen());

      expect(refresh).toHaveBeenCalledOnce();
    });

    it("refreshes the history when its first attempt failed", () => {
      renderStream();

      act(() => instance().onerror());
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      act(() => instance().onopen());

      expect(refresh).toHaveBeenCalledOnce();
    });

    it("leaves the refresh after a gateway recovery to the store's notify", () => {
      renderStream();
      act(() => instance().onopen());

      act(() => instance().sendStatus("connecting"));
      act(() => instance().sendStatus("live"));

      expect(refresh).not.toHaveBeenCalled();
    });

    it("refreshes once when it reconnects after the gateway went down", () => {
      renderStream();
      act(() => instance().onopen());
      act(() => instance().sendStatus("connecting"));

      act(() => {
        window.dispatchEvent(new Event("offline"));
        window.dispatchEvent(new Event("online"));
      });
      act(() => instance().onopen());
      act(() => instance().sendStatus("live"));

      expect(refresh).toHaveBeenCalledOnce();
    });

    it("closes EventSource on unmount", () => {
      const { unmount } = renderStream();
      const open = instance();

      unmount();

      expect(open.close).toHaveBeenCalled();
    });

    it("reconnects with exponential backoff on SSE error", () => {
      const { initialCount } = renderStream();
      const { instances } = mockEventSource;
      const first = instance();

      act(() => first.onerror());
      expect(first.close).toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(instances).toHaveLength(initialCount + 1);

      act(() => instance().onerror());
      act(() => {
        vi.advanceTimersByTime(3999);
      });
      expect(instances).toHaveLength(initialCount + 1);
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(instances).toHaveLength(initialCount + 2);
    });

    it("handles multiple onerror calls before reconnect", () => {
      const { initialCount } = renderStream();
      const open = instance();

      act(() => {
        open.onerror();
        open.onerror();
        open.onerror();
      });
      expect(open.close).toHaveBeenCalledOnce();

      act(() => {
        vi.advanceTimersByTime(30_000);
      });

      expect(mockEventSource.instances).toHaveLength(initialCount + 1);
    });

    it("resets reconnect attempts on successful connection", () => {
      const { initialCount } = renderStream();

      act(() => instance().onerror());
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      act(() => instance().onopen());
      act(() => instance().onerror());
      act(() => {
        vi.advanceTimersByTime(2000);
      });

      expect(mockEventSource.instances).toHaveLength(initialCount + 2);
    });

    it("clears pending reconnect timer on unmount", () => {
      const { initialCount, unmount } = renderStream();

      act(() => instance().onerror());
      unmount();
      vi.advanceTimersByTime(2000);

      expect(mockEventSource.instances).toHaveLength(initialCount);
    });

    it("caps the backoff at 30 seconds", () => {
      const { initialCount } = renderStream();
      const { instances } = mockEventSource;

      for (const backoff of [2000, 4000, 8000, 16_000]) {
        act(() => instance().onerror());
        act(() => {
          vi.advanceTimersByTime(backoff);
        });
      }
      expect(instances).toHaveLength(initialCount + 4);

      act(() => instance().onerror());
      act(() => {
        vi.advanceTimersByTime(29_999);
      });
      expect(instances).toHaveLength(initialCount + 4);
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(instances).toHaveLength(initialCount + 5);
    });
  });
});
