import { describe, expect, it, vi } from "vitest";

import { dayCard } from "@/listening/components/listeningCard";

import { toDay } from "../../toDay";
import openGraphImage from "./opengraph-image";

vi.mock(import("../../toDay"), () => ({
  toDay: vi.fn(() => Promise.resolve("2012-10-14" as const)),
}));

vi.mock(
  import("@/listening/components/listeningCard"),
  async (importOriginal) => ({ ...(await importOriginal()), dayCard: vi.fn() }),
);

describe("opengraph-image", () => {
  it("draws the day", async () => {
    await openGraphImage({
      params: Promise.resolve({ month: "2012-10", day: "14" }),
    });

    expect(toDay).toHaveBeenCalledWith({ month: "2012-10", day: "14" });
    expect(dayCard).toHaveBeenCalledWith("2012-10-14");
  });
});
