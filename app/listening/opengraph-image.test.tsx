import { describe, expect, it, vi } from "vitest";

import { listeningCard } from "@/listening/components/listeningCard";

import openGraphImage from "./opengraph-image";

vi.mock(
  import("@/listening/components/listeningCard"),
  async (importOriginal) => ({
    ...(await importOriginal()),
    listeningCard: vi.fn(),
  }),
);

describe("opengraph-image", () => {
  it("draws all time", async () => {
    await openGraphImage();

    expect(listeningCard).toHaveBeenCalledWith("overall");
  });
});
