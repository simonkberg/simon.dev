import { describe, expect, it, vi } from "vitest";

import { getToday } from "@/lib/today";

import { toDay, toMonth } from "./toDay";

vi.mock(import("next/navigation"), () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock(import("@/lib/today"), () => ({
  getToday: vi.fn(() => Promise.resolve("2026-10-28" as const)),
}));

const params = (date: string) => ({
  year: date.slice(0, 4),
  month: date.slice(5, 7),
  day: date.slice(8),
});

describe("toDay", () => {
  it.each(["2007-01-01", "2026-10-28"])("takes %s", async (param) => {
    expect(await toDay(params(param))).toBe(param);
  });

  it.each(["2006-12-31", "2026-10-29", "2026-02-30"])(
    "calls notFound for %s",
    async (param) => {
      await expect(toDay(params(param))).rejects.toThrow("NEXT_NOT_FOUND");
    },
  );

  it("doesn't read today for a date that isn't one", async () => {
    await expect(toDay({ year: "to", month: "day", day: "" })).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );

    expect(getToday).not.toHaveBeenCalled();
  });
});

describe("toMonth", () => {
  it("takes a month time travel reaches", async () => {
    expect(await toMonth({ year: "2026", month: "10" })).toBe("2026-10");
  });

  it("calls notFound for a month past today", async () => {
    await expect(toMonth({ year: "2026", month: "11" })).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
  });
});
