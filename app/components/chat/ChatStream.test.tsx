import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { refreshChatHistory } from "@/actions/chat";

import { ChatStream } from "./ChatStream";

vi.mock(import("@/actions/chat"), () => ({ refreshChatHistory: vi.fn() }));

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
  }

  return {
    MockEventSource,
    instances,
    getInstance(this: void, index = -1) {
      const instance = instances.at(index);
      if (!instance) {
        throw new Error(`No EventSource instance at ${index} available`);
      }
      return instance;
    },
  };
}

const status = () => screen.getByRole("status");

describe("ChatStream", () => {
  let mockEventSource: ReturnType<typeof createMockEventSource>;

  beforeEach(() => {
    mockEventSource = createMockEventSource();
    vi.stubGlobal("EventSource", mockEventSource.MockEventSource);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("status", () => {
    it("is connecting until the stream opens, then live", () => {
      render(<ChatStream />);

      expect(status()).toHaveTextContent("connecting");

      act(() => mockEventSource.getInstance().onopen());

      expect(status()).toHaveTextContent("live");
      expect(status()).toHaveAttribute("data-status", "live");
    });

    it("follows the server's gateway status", () => {
      render(<ChatStream />);
      const instance = mockEventSource.getInstance();
      act(() => instance.onopen());

      act(() => instance.sendStatus("connecting"));
      expect(status()).toHaveTextContent("connecting");

      act(() => instance.sendStatus("live"));
      expect(status()).toHaveTextContent("live");
    });

    it("is connecting while it waits to reconnect", () => {
      render(<ChatStream />);
      const instance = mockEventSource.getInstance();
      act(() => instance.onopen());

      act(() => instance.onerror());

      expect(status()).toHaveTextContent("connecting");
    });

    it("is offline without a network and reconnects when it's back", () => {
      vi.useFakeTimers();
      const onLine = vi
        .spyOn(navigator, "onLine", "get")
        .mockReturnValue(false);
      render(<ChatStream />);
      const { instances } = mockEventSource;
      const initialCount = instances.length;

      act(() => mockEventSource.getInstance().onerror());
      expect(status()).toHaveTextContent("offline");

      vi.advanceTimersByTime(30_000);
      expect(instances).toHaveLength(initialCount);

      onLine.mockReturnValue(true);
      act(() => {
        window.dispatchEvent(new Event("online"));
      });
      expect(status()).toHaveTextContent("connecting");
      expect(instances).toHaveLength(initialCount + 1);
    });

    it("goes offline and closes the stream when the network drops", () => {
      render(<ChatStream />);
      const instance = mockEventSource.getInstance();
      act(() => instance.onopen());

      act(() => {
        window.dispatchEvent(new Event("offline"));
      });

      expect(status()).toHaveTextContent("offline");
      expect(instance.close).toHaveBeenCalled();
    });
  });

  describe("connection", () => {
    it("calls refreshChatHistory when SSE message is received", () => {
      const { getInstance } = mockEventSource;

      render(<ChatStream />);

      const instance = getInstance();

      instance.onmessage();

      expect(refreshChatHistory).toHaveBeenCalled();
    });

    it("closes EventSource on unmount", () => {
      const { getInstance } = mockEventSource;

      const { unmount } = render(<ChatStream />);

      const instance = getInstance();

      unmount();

      expect(instance.close).toHaveBeenCalled();
    });

    it("reconnects with exponential backoff on SSE error", () => {
      vi.useFakeTimers();

      const { getInstance, instances } = mockEventSource;

      render(<ChatStream />);

      const initialCount = instances.length;
      expect(initialCount).toBeGreaterThanOrEqual(1);

      // Get the last instance (the active one)
      const firstInstance = getInstance(-1);

      // Trigger error on first connection
      firstInstance.onerror?.();

      expect(firstInstance.close).toHaveBeenCalled();

      // Advance by first backoff (2^1 * 1000 = 2000ms)
      vi.advanceTimersByTime(2000);

      expect(instances.length).toBe(initialCount + 1);

      // Get the new instance
      const secondInstance = getInstance(-1);

      // Trigger another error
      secondInstance.onerror();

      // Advance by second backoff (2^2 * 1000 = 4000ms)
      vi.advanceTimersByTime(4000);

      expect(instances.length).toBe(initialCount + 2);
    });

    it("handles multiple onerror calls before reconnect", () => {
      vi.useFakeTimers();

      const { getInstance, instances } = mockEventSource;

      render(<ChatStream />);

      const initialCount = instances.length;
      const instance = getInstance(-1);

      // Trigger onerror multiple times before reconnect timer fires
      instance.onerror();
      instance.onerror();
      instance.onerror();

      // close should only be called once (first onerror call)
      expect(instance.close).toHaveBeenCalledTimes(1);

      // Advance past the backoff - should still only create one new connection
      vi.advanceTimersByTime(30000);

      expect(instances.length).toBe(initialCount + 1);
    });

    it("resets reconnect attempts on successful connection", () => {
      vi.useFakeTimers();

      const { getInstance, instances } = mockEventSource;

      render(<ChatStream />);

      const initialCount = instances.length;
      const firstInstance = getInstance(-1);

      // Trigger error to increase backoff
      firstInstance.onerror();
      vi.advanceTimersByTime(2000);

      const secondInstance = getInstance(-1);

      // Trigger onopen to reset attempts
      secondInstance.onopen();

      // Trigger another error
      secondInstance.onerror();

      // If attempts were reset, backoff should be 2s again (not 4s)
      vi.advanceTimersByTime(2000);

      expect(instances.length).toBe(initialCount + 2);
    });

    it("clears pending reconnect timer on unmount", () => {
      vi.useFakeTimers();

      const { getInstance, instances } = mockEventSource;

      const { unmount } = render(<ChatStream />);

      const initialCount = instances.length;
      const firstInstance = getInstance(-1);

      // Trigger error to set reconnect timer
      firstInstance.onerror();

      // Unmount before timer fires
      unmount();

      // Advance timer - should not create new connection
      vi.advanceTimersByTime(2000);

      // No new connections should be created after unmount
      expect(instances.length).toBe(initialCount);
    });

    it("respects max backoff of 30 seconds", () => {
      vi.useFakeTimers();

      const { getInstance, instances } = mockEventSource;

      render(<ChatStream />);

      // Trigger many errors to exceed max backoff
      for (let i = 0; i < 6; i++) {
        getInstance(i).onerror();
        // 2^6 * 1000 = 64000ms > 30000ms max
        vi.advanceTimersByTime(30000);
      }

      // After 6 errors, backoff would be 64s without cap
      // With 30s cap, we should have reconnected
      expect(instances.length).toBeGreaterThan(6);
    });
  });
});
