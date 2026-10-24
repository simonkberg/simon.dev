import { Globals } from "@react-spring/web";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ScrobbleCount, BucketTopArtist } from "@/actions/lastfm";

import { ScrobbleChart } from "./ScrobbleChart";

const scrobbles: ScrobbleCount[] = [
  { label: "Oct 20", count: 100, current: false },
  { label: "Oct 21", count: 3000, current: false },
  { label: "Oct 22", count: 200, current: false },
  { label: "Oct 23", count: 10, current: true },
];

const renderChart = (items: readonly ScrobbleCount[] | undefined) =>
  act(async () =>
    render(
      <ScrobbleChart
        scrobbles={Promise.resolve(items)}
        topArtistByBucket={Promise.resolve(undefined)}
      />,
    ),
  );

const smog = (playcount: number) => ({ name: "Smog", playcount });

const buckets: BucketTopArtist[] = [
  { label: "2016", artist: smog(5) },
  { label: "2017", artist: smog(7) },
  { label: "2018", artist: { name: "Low", playcount: 3 } },
  { label: "2019", artist: undefined },
  { label: "2020", artist: smog(2) },
  { label: "2021", artist: { name: "Bill Callahan", playcount: 4 } },
];

const renderLanes = (
  topArtistByBucket: readonly BucketTopArtist[] | undefined,
) =>
  act(async () =>
    render(
      <ScrobbleChart
        scrobbles={Promise.resolve(
          buckets.map(({ label }, index) => ({
            label,
            count: 10,
            current: index === buckets.length - 1,
          })),
        )}
        topArtistByBucket={Promise.resolve(topArtistByBucket)}
      />,
    ),
  );

const lanes = () =>
  within(screen.getByRole("list", { name: "Top artists" })).getAllByRole(
    "listitem",
  );

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
      "Oct 23: 10 so farOct 23",
    ]);
  });

  it("averages the settled buckets only", async () => {
    await renderChart(scrobbles);

    expect(document.querySelector(".average")).toHaveTextContent("1,100 avg");
  });

  it("gives each top artist a lane with a bar per run of its buckets", async () => {
    await renderLanes(buckets);

    expect(
      lanes().map(
        (item) => item.querySelector(".visually-hidden")?.textContent,
      ),
    ).toEqual([
      "Smog: 14 plays in 2016–2017, 2020",
      "Low: 3 plays in 2018",
      "Bill Callahan: 4 plays in 2021",
    ]);
  });

  it("ends a late lane's name at its run and dashes the current one", async () => {
    await renderLanes(buckets);
    const [smogLane, , lateLane] = lanes();

    expect(smogLane?.querySelector("[data-end]")).not.toBeInTheDocument();
    expect(smogLane?.querySelector("[data-current]")).not.toBeInTheDocument();
    expect(lateLane?.querySelector(".lane-label")).toHaveAttribute("data-end");
    expect(lateLane?.querySelector(".lane-run")).toHaveAttribute(
      "data-current",
    );
  });

  it("lights a lane's stems while it is hovered", async () => {
    await renderLanes(buckets);
    const active = () =>
      stems().map((item) => item.hasAttribute("data-active"));

    fireEvent.pointerEnter(lanes()[0]!);
    expect(active()).toEqual([true, true, false, false, true, false]);

    fireEvent.pointerLeave(screen.getByRole("list", { name: "Top artists" }));
    expect(active()).toEqual([false, false, false, false, false, false]);
  });

  it.each([
    ["failed to load", undefined],
    ["have none", buckets.map(({ label }) => ({ label, artist: undefined }))],
  ])(
    "leaves the lanes out when the artists %s",
    async (_, topArtistByBucket) => {
      await renderLanes(topArtistByBucket);

      expect(stems()).toHaveLength(buckets.length);
      expect(
        screen.queryByRole("list", { name: "Top artists" }),
      ).not.toBeInTheDocument();
    },
  );

  it("scales a lone empty bucket with no average to show", async () => {
    await renderChart([{ label: "2026", count: 0, current: true }]);

    const figure = document.querySelector<HTMLElement>(".stems");
    expect(figure?.style.getPropertyValue("--max")).toBe("1");
    expect(figure?.querySelector(".average")).not.toBeInTheDocument();
  });

  it("labels every other few buckets from the current one", async () => {
    await renderChart(
      Array.from({ length: 13 }, (_, index) => ({
        label: `W${index}`,
        count: index,
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

  it("counts the peak and average up from zero when mounted on the client", async () => {
    Globals.assign({ skipAnimation: false });

    await renderChart(scrobbles);

    expect(document.querySelector(".peak")).toHaveTextContent("0");
    expect(document.querySelector(".average")).toHaveTextContent("0 avg");
  });

  it("sweeps the lane bars in when mounted on the client", async () => {
    Globals.assign({ skipAnimation: false });

    await renderLanes(buckets);

    const grow = (selector: string) =>
      [...document.querySelectorAll<HTMLElement>(selector)].map((element) =>
        Number(element.style.getPropertyValue("--grow")),
      );
    const runs = grow(".lane-run");
    expect(runs).toHaveLength(4);
    expect(Math.max(...runs)).toBeLessThan(1);
    expect(grow(".lane-label")).toHaveLength(3);
  });

  it("renders full stems in server markup", () => {
    // A resolved promise still suspends on the server, so render the settled tree.
    const settled = <T,>(value: T) =>
      Object.assign(Promise.resolve(value), { status: "fulfilled", value });
    const html = renderToString(
      <ScrobbleChart
        scrobbles={settled(scrobbles)}
        topArtistByBucket={settled(undefined)}
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
