import { describe, expect, it, vi } from "vitest";

import { dayCard } from "@/listening/components/listeningCard";

import openGraphImage from "./opengraph-image";
import { toDay } from "./toDay";

vi.mock(import("./toDay"), () => ({
  toDay: vi.fn((param: string) => Promise.resolve(param as "2012-10-14")),
}));

vi.mock(
  import("@/listening/components/listeningCard"),
  async (importOriginal) => ({ ...(await importOriginal()), dayCard: vi.fn() }),
);

describe("opengraph-image", () => {
  it("draws the day", async () => {
    await openGraphImage({ params: Promise.resolve({ date: "2012-10-14" }) });

    expect(toDay).toHaveBeenCalledWith("2012-10-14");
    expect(dayCard).toHaveBeenCalledWith("2012-10-14");
  });
});
