import { describe, expect, it, vi } from "vitest";

import { getToday } from "@/lib/today";

import { toDay } from "./toDay";

vi.mock(import("next/navigation"), () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock(import("@/lib/today"), () => ({
  getToday: vi.fn(() => Promise.resolve("2026-10-28" as const)),
}));

describe("toDay", () => {
  it.each(["2007-01-01", "2026-10-28"])("takes %s", async (param) => {
    expect(await toDay(param)).toBe(param);
  });

  it.each(["2006-12-31", "2026-10-29", "2026-02-30"])(
    "calls notFound for %s",
    async (param) => {
      await expect(toDay(param)).rejects.toThrow("NEXT_NOT_FOUND");
    },
  );

  it("doesn't read today for a date that isn't one", async () => {
    await expect(toDay("today")).rejects.toThrow("NEXT_NOT_FOUND");

    expect(getToday).not.toHaveBeenCalled();
  });
});
