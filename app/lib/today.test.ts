import { cacheLife } from "next/cache";
import { describe, expect, it, vi } from "vitest";

import { getToday } from "./today";

vi.mock(import("next/cache"), () => ({ cacheLife: vi.fn() }));

describe("getToday", () => {
  it("should give Stockholm's date until its midnight", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-23T22:30:00Z"));

    expect(await getToday()).toBe("2026-10-24");
    expect(cacheLife).toHaveBeenCalledExactlyOnceWith({
      stale: 300,
      revalidate: 84_600,
      expire: 84_600 + 86_400,
    });
  });
});
