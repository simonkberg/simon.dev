import { redirect } from "next/navigation";
import { describe, expect, it, vi } from "vitest";

import TimeTravelStart from "./page";

vi.mock(import("next/navigation"), () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

vi.mock(import("next/server"), () => ({ connection: vi.fn() }));

vi.mock(import("@/lib/today"), () => ({
  getToday: vi.fn(() => Promise.resolve("2026-10-28" as const)),
}));

describe("TimeTravelStart", () => {
  it("travels to a year ago today", async () => {
    await expect(TimeTravelStart()).rejects.toThrow("NEXT_REDIRECT");

    expect(redirect).toHaveBeenCalledWith("/listening/on/2025-10-28");
  });
});
