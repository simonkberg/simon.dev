import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { config } from "@/config";

import { AlbumCover } from "./AlbumCover";

const cover = `${config.lastfmCoverCdn}abc.jpg`;

const renderCover = (src: string | undefined) =>
  render(<AlbumCover src={src} width={160} />);

const image = () => screen.getByRole("presentation");
const hidden = () => image().closest("[data-failed]") !== null;
const fail = () => fireEvent.error(image());
const wait = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

describe("AlbumCover", () => {
  it("shows the cover", () => {
    renderCover(cover);

    expect(image()).toHaveAttribute("src", expect.stringContaining("abc.jpg"));
    expect(hidden()).toBe(false);
  });

  it("renders nothing for an album without a cover", () => {
    const { container } = renderCover(undefined);

    expect(container).toBeEmptyDOMElement();
  });

  it("hides a failed cover while it retries, until one loads", async () => {
    renderCover(cover);
    const first = image();

    fail();
    expect(hidden()).toBe(true);

    wait(5_999);
    expect(image()).toBe(first);
    wait(1);
    expect(image()).not.toBe(first);
    expect(hidden()).toBe(true);

    await act(async () => fireEvent.load(image()));
    expect(hidden()).toBe(false);
  });

  it("waits for a retry to fail before the next", () => {
    renderCover(cover);

    fail();
    wait(6_000);
    const retried = image();
    wait(60_000);

    expect(image()).toBe(retried);
  });

  it("stays hidden once its retries have failed", () => {
    renderCover(cover);

    fail();
    wait(6_000);
    fail();
    wait(15_000);
    const last = image();
    fail();
    wait(60_000);

    expect(image()).toBe(last);
    expect(hidden()).toBe(true);
  });
});
