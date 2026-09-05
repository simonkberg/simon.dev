import { beforeEach, describe, expect, it, vi } from "vitest";

import { getGlobal, resetGlobal } from "./global";

const KEY = "simon.dev/test";

describe("getGlobal", () => {
  beforeEach(() => {
    resetGlobal(KEY);
  });

  it("should create the value once and return the same instance", () => {
    const init = vi.fn(() => ({}));

    const first = getGlobal(KEY, init);
    const second = getGlobal(KEY, init);

    expect(second).toBe(first);
    expect(init).toHaveBeenCalledOnce();
  });

  it("should survive a module reset", async () => {
    const value = getGlobal(KEY, () => ({}));

    vi.resetModules();
    const fresh = await import("./global");

    expect(fresh.getGlobal(KEY, () => ({}))).toBe(value);
  });

  it("should create a new value after reset", () => {
    const first = getGlobal(KEY, () => ({}));
    resetGlobal(KEY);

    expect(getGlobal(KEY, () => ({}))).not.toBe(first);
  });
});
