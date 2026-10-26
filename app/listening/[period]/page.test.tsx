import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ListeningPeriod } from "@/listening/components/ListeningPeriod";

import ListeningPeriodPage, {
  generateMetadata,
  generateStaticParams,
} from "./page";

vi.mock(import("next/navigation"), () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock(
  import("@/listening/components/ListeningPeriod"),
  async (importOriginal) => ({
    ...(await importOriginal()),
    ListeningPeriod: vi.fn(({ period }) => <p>{period}</p>),
  }),
);

const searchParams = Promise.resolve({});

const metadataFor = (period: string) =>
  generateMetadata({ params: Promise.resolve({ period }), searchParams });

describe("generateMetadata", () => {
  it("names the period", async () => {
    expect(await metadataFor("7day")).toMatchObject({
      title: "Listening - 7 days",
    });
  });

  it.each(["invalid", "overall"])("calls notFound for %s", async (period) => {
    await expect(metadataFor(period)).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("generateStaticParams", () => {
  it("lists every period but all time, which is /listening", () => {
    expect(generateStaticParams()).toEqual([
      { period: "7day" },
      { period: "1month" },
      { period: "3month" },
      { period: "6month" },
      { period: "12month" },
    ]);
  });
});

describe("ListeningPeriodPage", () => {
  it("shows the period", async () => {
    await act(async () =>
      render(
        <ListeningPeriodPage
          params={Promise.resolve({ period: "7day" })}
          searchParams={searchParams}
        />,
      ),
    );

    expect(screen.getByText("7day")).toBeInTheDocument();
    expect(ListeningPeriod).toHaveBeenCalledWith({ period: "7day" }, undefined);
  });
});
