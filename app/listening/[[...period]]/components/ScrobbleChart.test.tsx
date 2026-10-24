import { Globals } from "@react-spring/web";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ScrobbleCount } from "@/actions/lastfm";

import { ScrobbleChart } from "./ScrobbleChart";

const smog = (playcount: number) => ({ name: "Smog", playcount });

const scrobbles: ScrobbleCount[] = [
  { label: "Oct 20", count: 100, topArtist: smog(5), current: false },
  { label: "Oct 21", count: 3000, topArtist: smog(7), current: false },
  {
    label: "Oct 22",
    count: 200,
    topArtist: { name: "Low", playcount: 3 },
    current: false,
  },
  { label: "Oct 23", count: 0, topArtist: undefined, current: true },
];

const renderChart = (items: readonly ScrobbleCount[] | undefined) =>
  act(async () => render(<ScrobbleChart scrobbles={Promise.resolve(items)} />));

const stems = () => [...document.querySelectorAll<HTMLElement>(".stems li")];

const ticks = () =>
  [...document.querySelectorAll(".tick")].map((tick) => tick.textContent);

describe("ScrobbleChart", () => {
  it("names each bucket's count, the current one so far", async () => {
    await renderChart(scrobbles);

    expect(stems().map((item) => item.textContent)).toEqual([
      "Oct 20: 100Oct 20",
      "Oct 21: 3,0003,000Oct 21",
      "Oct 22: 200Oct 22",
      "Oct 23: 0 so farOct 23",
    ]);
  });

  it("averages the settled buckets only", async () => {
    await renderChart(scrobbles);

    expect(document.querySelector(".average")).toHaveTextContent("1,100 avg");
  });

  it("shelves neighbouring buckets with the same top artist on one spine", async () => {
    await renderChart(scrobbles);

    const shelf = screen.getByRole("list", { name: "Top artists" });
    expect(
      within(shelf)
        .getAllByRole("listitem")
        .map((item) => item.querySelector(".visually-hidden")?.textContent),
    ).toEqual([
      "Oct 20–Oct 21: Smog, 12 plays",
      "Oct 22: Low, 3 plays",
      "Oct 23: no scrobbles",
    ]);
  });

  it("keeps empty buckets apart from ones whose artist failed to load", async () => {
    await renderChart([
      { label: "2016", count: 0, topArtist: undefined, current: false },
      { label: "2017", count: 5, topArtist: undefined, current: false },
    ]);

    expect(screen.getByText("2016: no scrobbles")).toBeInTheDocument();
    expect(
      screen.getByText("2017: top artist unavailable"),
    ).toBeInTheDocument();
  });

  it("lights a spine's stems while it is hovered", async () => {
    await renderChart(scrobbles);
    const spine = screen.getByText(
      "Oct 20–Oct 21: Smog, 12 plays",
    ).parentElement;
    const active = () =>
      stems().map((item) => item.hasAttribute("data-active"));

    fireEvent.pointerEnter(spine!);
    expect(active()).toEqual([true, true, false, false]);

    fireEvent.pointerLeave(spine!);
    expect(active()).toEqual([false, false, false, false]);
  });

  it("scales a lone empty bucket with no average to show", async () => {
    await renderChart([
      { label: "2026", count: 0, topArtist: undefined, current: true },
    ]);

    const figure = document.querySelector<HTMLElement>(".stems");
    expect(figure?.style.getPropertyValue("--max")).toBe("1");
    expect(figure?.querySelector(".average")).not.toBeInTheDocument();
  });

  it("labels every other few buckets from the current one", async () => {
    await renderChart(
      Array.from({ length: 13 }, (_, index) => ({
        label: `W${index}`,
        count: index,
        topArtist: undefined,
        current: false,
      })),
    );

    expect(ticks()).toEqual(["W0", "W3", "W6", "W9", "W12"]);
    expect(document.querySelector('[data-tick="narrow"]')).toHaveTextContent(
      "W0",
    );
  });

  it("grows the stems in when mounted on the client", async () => {
    Globals.assign({ skipAnimation: false });

    await renderChart(scrobbles);

    const grow = stems().map((item) =>
      Number(item.style.getPropertyValue("--grow")),
    );
    expect(Math.max(...grow)).toBeLessThan(1);
  });

  it("renders full stems in server markup", () => {
    // A resolved promise still suspends on the server, so render the settled tree.
    const html = renderToString(
      <ScrobbleChart
        scrobbles={Object.assign(Promise.resolve(scrobbles), {
          status: "fulfilled",
          value: scrobbles,
        })}
      />,
    );

    expect(html).toContain("--grow:1");
  });

  it("says so when the counts failed to load", async () => {
    await renderChart(undefined);

    expect(
      screen.getByText("Scrobbles are temporarily unavailable :("),
    ).toBeInTheDocument();
  });
});
