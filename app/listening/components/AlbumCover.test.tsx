import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { config } from "@/config";

import { AlbumCover } from "./AlbumCover";

const cover = `${config.lastfmCoverCdn}abc.jpg`;

const renderCover = (src: string | undefined) =>
  render(<AlbumCover src={src} width={160} name="Knock Knock" artist="Smog" />);

const sleeve = () => screen.queryByText("Knock Knock");
const image = () => screen.getByRole("presentation");
const fail = () => fireEvent.error(image());
const wait = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

describe("AlbumCover", () => {
  it("shows the cover without a sleeve", () => {
    renderCover(cover);

    expect(image()).toHaveAttribute("src", expect.stringContaining("abc.jpg"));
    expect(sleeve()).not.toBeInTheDocument();
  });

  it("shows a sleeve for an album without a cover", () => {
    renderCover(undefined);

    expect(screen.queryByRole("presentation")).not.toBeInTheDocument();
    expect(sleeve()).toBeInTheDocument();
    expect(screen.getByText("Smog")).toBeInTheDocument();
  });

  it("shows a sleeve while a failed cover retries, until one loads", async () => {
    renderCover(cover);
    const first = image();

    fail();
    expect(sleeve()).toBeInTheDocument();

    wait(5_999);
    expect(image()).toBe(first);
    wait(1);
    expect(image()).not.toBe(first);
    expect(sleeve()).toBeInTheDocument();

    await act(async () => fireEvent.load(image()));
    expect(sleeve()).not.toBeInTheDocument();
  });

  it("waits for a retry to fail before the next", () => {
    renderCover(cover);

    fail();
    wait(6_000);
    const retried = image();
    wait(60_000);

    expect(image()).toBe(retried);
  });

  it("keeps the sleeve once its retries have failed", () => {
    renderCover(cover);

    fail();
    wait(6_000);
    fail();
    wait(15_000);
    const last = image();
    fail();
    wait(60_000);

    expect(image()).toBe(last);
    expect(sleeve()).toBeInTheDocument();
  });
});
