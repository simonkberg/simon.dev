import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetGlobal } from "./global";
import { log } from "./log";
import { getPendingStages, markReady } from "./readiness";

vi.mock(import("server-only"), () => ({}));

describe("readiness", () => {
  beforeEach(() => {
    resetGlobal("simon.dev/readiness");
    vi.spyOn(log, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

  it("should log each stage and when the service is ready", () => {
    markReady("migrations");
    expect(log.info).toHaveBeenCalledWith(
      { stage: "migrations", pending: ["bot"] },
      "Stage ready",
    );

    markReady("bot");
    expect(log.info).toHaveBeenCalledWith(
      { stage: "bot", pending: [] },
      "Service ready",
    );
  });

  it("should share state across module instances", async () => {
    markReady("migrations");

    vi.resetModules();
    const fresh = await import("./readiness");

    expect(fresh.getPendingStages()).toEqual(["bot"]);
  });
});
