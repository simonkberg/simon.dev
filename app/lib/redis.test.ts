import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetGlobal } from "./global";

vi.mock(import("server-only"), () => ({}));

describe("getRedis", () => {
  beforeEach(() => {
    vi.resetModules();
    resetGlobal("simon.dev/redis");
  });

  it("should return a Redis instance", async () => {
    const { getRedis } = await import("./redis");
    const redis = getRedis();
    expect(redis).toBeDefined();
    expect(redis).toHaveProperty("get");
    expect(redis).toHaveProperty("set");
  });

  it("should return the same instance on subsequent calls", async () => {
    const { getRedis } = await import("./redis");
    const redis1 = getRedis();
    const redis2 = getRedis();
    expect(redis1).toBe(redis2);
  });
});
