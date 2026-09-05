import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetGlobal } from "./global";
import { getPendingStages, markReady } from "./readiness";

vi.mock(import("server-only"), () => ({}));

describe("readiness", () => {
  beforeEach(() => {
    resetGlobal("simon.dev/readiness");
  });

  it("should start with every stage pending", () => {
    expect(getPendingStages()).toEqual(["migrations", "bot"]);
  });

  it("should drop a stage once it is marked ready", () => {
    markReady("migrations");

    expect(getPendingStages()).toEqual(["bot"]);
  });

  it("should have nothing pending once every stage is ready", () => {
    markReady("bot");
    markReady("migrations");

    expect(getPendingStages()).toEqual([]);
  });

  it("should share state across module instances", async () => {
    markReady("migrations");

    vi.resetModules();
    const fresh = await import("./readiness");

    expect(fresh.getPendingStages()).toEqual(["bot"]);
  });
});
