import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { server } from "@/mocks/node";

import { getStats, type Period, periods } from "./wakaTime";

const WAKATIME_BASE_URL = "https://wakatime.com/share/@simonkberg";
const STATS_URLS: Record<Period, string> = {
  last_7_days: "b2bb44ec-d8bd-42ee-ad9d-8948172388d0.json",
  last_30_days: "2daa8cdd-2a7e-4deb-836f-b913a308a93a.json",
  last_year: "bdbe1607-6d0d-418c-aa98-9602535e8f6b.json",
  all_time: "b65f0e73-704a-44ce-9538-eee4fc913be8.json",
};

describe("periods", () => {
  it("should export all valid periods", () => {
    expect(periods).toEqual([
      "last_7_days",
      "last_30_days",
      "last_year",
      "all_time",
    ]);
  });
});

describe("getStats", () => {
  it("should fetch and parse WakaTime stats successfully", async () => {
    server.use(
      http.get(`${WAKATIME_BASE_URL}/${STATS_URLS.last_7_days}`, () =>
        HttpResponse.json({
          data: [
            { name: "TypeScript", percent: 45.5 },
            { name: "JavaScript", percent: 30.2 },
            { name: "JSON", percent: 15.3 },
          ],
        }),
      ),
    );

    const stats = await getStats();

    expect(stats).toEqual([
      { name: "TypeScript", percent: 45.5 },
      { name: "JavaScript", percent: 30.2 },
      { name: "JSON", percent: 15.3 },
    ]);
  });

  it("should use last_7_days as the default period", async () => {
    server.use(
      http.get(`${WAKATIME_BASE_URL}/${STATS_URLS.last_7_days}`, () =>
        HttpResponse.json({ data: [{ name: "TypeScript", percent: 100 }] }),
      ),
    );

    const stats = await getStats();

    expect(stats).toEqual([{ name: "TypeScript", percent: 100 }]);
  });

  it.each(periods)("should fetch stats for period: %s", async (period) => {
    server.use(
      http.get(`${WAKATIME_BASE_URL}/${STATS_URLS[period]}`, () =>
        HttpResponse.json({ data: [{ name: "TypeScript", percent: 50 }] }),
      ),
    );

    const stats = await getStats(period);

    expect(stats).toEqual([{ name: "TypeScript", percent: 50 }]);
  });

  it("should limit results to specified limit", async () => {
    server.use(
      http.get(`${WAKATIME_BASE_URL}/${STATS_URLS.last_7_days}`, () =>
        HttpResponse.json({
          data: [
            { name: "TypeScript", percent: 40 },
            { name: "JavaScript", percent: 30 },
            { name: "JSON", percent: 15 },
            { name: "CSS", percent: 10 },
            { name: "HTML", percent: 5 },
          ],
        }),
      ),
    );

    const stats = await getStats("last_7_days", 3);

    expect(stats).toHaveLength(3);
    expect(stats).toEqual([
      { name: "TypeScript", percent: 40 },
      { name: "JavaScript", percent: 30 },
      { name: "JSON", percent: 15 },
    ]);
  });

  it("should use default limit of 15", async () => {
    const manyLanguages = Array.from({ length: 20 }, (_, i) => ({
      name: `Language${i}`,
      percent: 5,
    }));

    server.use(
      http.get(`${WAKATIME_BASE_URL}/${STATS_URLS.last_7_days}`, () =>
        HttpResponse.json({ data: manyLanguages }),
      ),
    );

    const stats = await getStats();

    expect(stats).toHaveLength(15);
  });

  it("should handle invalid response schema", async () => {
    server.use(
      http.get(`${WAKATIME_BASE_URL}/${STATS_URLS.last_7_days}`, () =>
        HttpResponse.json({ data: [{ invalid: "data" }] }),
      ),
    );

    await expect(getStats()).rejects.toThrow();
  });

  it("should handle network errors", async () => {
    server.use(
      http.get(`${WAKATIME_BASE_URL}/${STATS_URLS.last_7_days}`, () =>
        HttpResponse.error(),
      ),
    );

    await expect(getStats()).rejects.toThrow();
  });

  it("should configure fetch with 3 second timeout", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");

    server.use(
      http.get(`${WAKATIME_BASE_URL}/${STATS_URLS.last_7_days}`, () =>
        HttpResponse.json({ data: [{ name: "TypeScript", percent: 45.5 }] }),
      ),
    );

    await getStats();

    expect(timeoutSpy).toHaveBeenCalledWith(3000);
    timeoutSpy.mockRestore();
  });

  it.each([
    { status: 404, statusText: "Not Found" },
    { status: 429, statusText: "Too Many Requests" },
    { status: 500, statusText: "Internal Server Error" },
    { status: 503, statusText: "Service Unavailable" },
  ])("should handle HTTP $status error", async ({ status, statusText }) => {
    server.use(
      http.get(
        `${WAKATIME_BASE_URL}/${STATS_URLS.last_7_days}`,
        () => new HttpResponse(null, { status, statusText }),
      ),
    );

    await expect(getStats()).rejects.toThrow(
      `WakaTime API error: ${status} ${statusText}`,
    );
  });
});
