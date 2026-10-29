import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useTimeout } from "./useTimeout";

describe("useTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("calls back once the time passes", () => {
    const callback = vi.fn();
    renderHook(() => useTimeout(callback, 1000));

    vi.advanceTimersByTime(999);
    expect(callback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledOnce();
  });

  it("waits for nothing without a time", () => {
    const callback = vi.fn();
    renderHook(() => useTimeout(callback, undefined));

    vi.runAllTimers();

    expect(callback).not.toHaveBeenCalled();
  });

  it("waits again when restarted", () => {
    const callback = vi.fn();
    const { rerender } = renderHook(
      ({ restart }) => useTimeout(callback, 1000, restart),
      { initialProps: { restart: 0 } },
    );

    vi.advanceTimersByTime(600);
    rerender({ restart: 1 });
    vi.advanceTimersByTime(600);

    expect(callback).not.toHaveBeenCalled();
  });

  it("calls the latest callback without restarting", () => {
    const first = vi.fn();
    const latest = vi.fn();
    const { rerender } = renderHook(
      ({ callback }) => useTimeout(callback, 1000),
      { initialProps: { callback: first } },
    );

    vi.advanceTimersByTime(600);
    rerender({ callback: latest });
    vi.advanceTimersByTime(400);

    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledOnce();
  });

  it("stops waiting on unmount", () => {
    const callback = vi.fn();
    const { unmount } = renderHook(() => useTimeout(callback, 1000));

    unmount();
    vi.runAllTimers();

    expect(callback).not.toHaveBeenCalled();
  });
});
