import { describe, expect, it, vi } from "vitest";

import { GET } from "./route";

vi.mock(import("next/server"), () => ({ connection: vi.fn() }));

vi.mock(import("@/lib/today"), () => ({
  getToday: vi.fn(() => Promise.resolve("2026-10-28" as const)),
}));

describe("GET /listening/on", () => {
  it("redirects to a year ago today", async () => {
    const response = await GET();

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("/listening/on/2025-10-28");
  });
});
