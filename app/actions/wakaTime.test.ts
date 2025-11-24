import { cacheLife } from "next/cache";
import { afterEach, describe, expect, it, vi } from "vitest";

import { log } from "@/lib/log";
import { getStats, type WakaTimeStats } from "@/lib/wakaTime";

import { getWakaTimeStats } from "./wakaTime";

vi.mock(import("@/lib/wakaTime"), () => ({ getStats: vi.fn() }));

vi.mock(import("next/cache"), () => ({ cacheLife: vi.fn() }));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getWakaTimeStats", () => {
  it("should return success status with stats when getStats succeeds", async () => {
    const mockStats: WakaTimeStats = [
      { name: "TypeScript", percent: 45.5 },
      { name: "JavaScript", percent: 30.2 },
      { name: "JSON", percent: 15.3 },
    ];

    vi.mocked(getStats).mockResolvedValue(mockStats);

    const result = await getWakaTimeStats();

    expect(result).toEqual({ status: "ok", stats: mockStats });
    expect(cacheLife).toHaveBeenCalledWith("hours");
  });

  it("should return error status when getStats fails", async () => {
    const logErrorSpy = vi.spyOn(log, "error").mockImplementation(() => {});

    const mockError = new Error("Network error");
    vi.mocked(getStats).mockRejectedValue(mockError);

    const result = await getWakaTimeStats();

    expect(result).toEqual({
      status: "error",
      error: "Failed to fetch WakaTime stats",
    });

    expect(logErrorSpy).toHaveBeenCalledWith(
      { err: mockError, action: "getWakaTimeStats" },
      "Error fetching WakaTime stats",
    );
    expect(cacheLife).toHaveBeenCalledWith("seconds");
  });
});
