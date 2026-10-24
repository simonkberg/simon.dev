import { act, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { TopAlbum } from "@/actions/lastfm";

import { AlbumCollage, AlbumCollageSkeleton } from "./AlbumCollage";

const cover = "https://lastfm-img.freetls.fastly.net/i/u/abc.jpg";

const albums: TopAlbum[] = [
  {
    name: "Knock Knock",
    artist: "Smog",
    playcount: 31,
    rank: 1,
    url: "https://www.last.fm/music/Smog/Knock+Knock",
    cover,
  },
  {
    name: "Beheaded",
    artist: "Bedhead",
    playcount: 30,
    rank: 2,
    url: "https://www.last.fm/music/Bedhead/Beheaded",
    cover,
  },
  {
    name: "Stuff Like That There",
    artist: "Yo La Tengo",
    playcount: 26,
    rank: 3,
    url: "https://www.last.fm/music/Yo+La+Tengo/Stuff+Like+That+There",
    cover: undefined,
  },
];

const renderCollage = (items: TopAlbum[] | undefined) =>
  act(async () => render(<AlbumCollage albums={Promise.resolve(items)} />));

describe("AlbumCollage", () => {
  it("links each cover to its album on Last.fm", async () => {
    await renderCollage(albums);

    const link = screen.getByRole("link", {
      name: "Knock Knock by Smog on Last.fm",
    });
    expect(link).toHaveAttribute(
      "href",
      "https://www.last.fm/music/Smog/Knock+Knock",
    );
    for (const image of within(link).getAllByRole("presentation")) {
      expect(image).toHaveAttribute("src", expect.stringContaining("abc.jpg"));
    }
  });

  it("leaves a cover's tile empty when the album has no art", async () => {
    await renderCollage(albums);

    const link = screen.getByRole("link", {
      name: "Stuff Like That There by Yo La Tengo on Last.fm",
    });
    expect(within(link).queryByRole("presentation")).not.toBeInTheDocument();
  });

  it("pads a short list with empty tiles to fill the grid", async () => {
    await renderCollage(albums);

    const [covers] = screen.getAllByRole("list");
    expect(
      within(covers!).getAllByRole("listitem", { hidden: true }),
    ).toHaveLength(10);
    expect(within(covers!).getAllByRole("listitem")).toHaveLength(3);
  });

  it("lists each album's rank, name, artist and plays", async () => {
    await renderCollage(albums);

    const [, legend] = screen.getAllByRole("list");
    expect(
      within(legend!)
        .getAllByRole("listitem")
        .map((item) => [...item.children].map((child) => child.textContent)),
    ).toEqual([
      ["1", "Knock Knock", "Smog", "31"],
      ["2", "Beheaded", "Bedhead", "30"],
      ["3", "Stuff Like That There", "Yo La Tengo", "26"],
    ]);
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
