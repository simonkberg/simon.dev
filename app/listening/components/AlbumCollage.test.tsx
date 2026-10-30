import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { TopAlbum } from "@/actions/listening";
import { config } from "@/config";
import { topAlbum } from "@/mocks/listening";

import { AlbumCollage, AlbumCollageSkeleton } from "./AlbumCollage";

const cover = `${config.lastfmCoverCdn}abc.jpg`;

const albums = [
  topAlbum("Knock Knock", "Smog", 1, cover),
  topAlbum("Beheaded", "Bedhead", 2, cover),
  topAlbum("Stuff Like That There", "Yo La Tengo", 3),
];

const renderCollage = (items: TopAlbum[] | undefined) =>
  act(async () => render(<AlbumCollage albums={Promise.resolve(items)} />));

describe("AlbumCollage", () => {
  it("links each cover to its album on Last.fm", async () => {
    await renderCollage(albums);

    const link = screen.getByRole("link", {
      name: "Knock Knock by Smog, 39 plays, on Last.fm",
    });
    expect(link).toHaveAttribute(
      "href",
      "https://www.last.fm/music/Smog/Knock+Knock",
    );
    for (const image of within(link).getAllByRole("presentation")) {
      expect(image).toHaveAttribute("src", expect.stringContaining("abc.jpg"));
    }
  });

  it("captions each cover with its rank, plays, name and artist", async () => {
    await renderCollage(albums);

    const link = screen.getByRole("link", {
      name: "Stuff Like That There by Yo La Tengo, 37 plays, on Last.fm",
    });
    expect(
      [".cover-rank", ".cover-plays", ".caption-name", ".caption-artist"].map(
        (selector) => link.querySelector(selector)?.textContent,
      ),
    ).toEqual(["3", "37", "Stuff Like That There", "Yo La Tengo"]);
  });

  it("doesn't pass a failed cover to the album taking its rank", async () => {
    const { rerender } = await renderCollage(albums);
    const [image] = screen.getAllByRole("presentation");
    fireEvent.error(image!);

    await act(async () =>
      rerender(
        <AlbumCollage
          albums={Promise.resolve([
            topAlbum("Pale", "Mimi", 1, `${config.lastfmCoverCdn}pale.jpg`),
          ])}
        />,
      ),
    );

    const link = screen.getByRole("link", {
      name: "Pale by Mimi, 39 plays, on Last.fm",
    });
    expect(link.querySelector("[data-failed]")).not.toBeInTheDocument();
  });

  it("pads a short list with empty tiles to fill the grid", async () => {
    await renderCollage(albums);

    const covers = screen.getByRole("list");
    expect(
      within(covers).getAllByRole("listitem", { hidden: true }),
    ).toHaveLength(10);
    expect(within(covers).getAllByRole("listitem")).toHaveLength(3);
  });

  it("says the albums are unavailable when they failed to load", async () => {
    await renderCollage(undefined);

    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(
      screen.getByText("Top albums are temporarily unavailable :("),
    ).toBeInTheDocument();
  });
});

describe("AlbumCollageSkeleton", () => {
  it("announces loading without exposing the placeholder", () => {
    render(<AlbumCollageSkeleton />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});
