import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UserGetTopAlbumsResponse } from "@/lib/lastfm";
import { userGetTopAlbums } from "@/lib/lastfm";
import { log } from "@/lib/log";
import { server } from "@/mocks/node";

import { coverSrc, warmCovers } from "./covers";

vi.mock(import("@/lib/lastfm"), async (importOriginal) => ({
  ...(await importOriginal()),
  userGetTopAlbums: vi.fn(),
}));

const origin = "http://localhost:3000";
const cdn = "https://lastfm-img.freetls.fastly.net/i/u";

const album = (hash: string | undefined, rank: number) => ({
  name: `Album ${rank}`,
  artist: "Artist",
  playcount: 10,
  rank,
  url: `https://www.last.fm/music/Artist/Album+${rank}` as const,
  cover: hash && `${cdn}/${hash}.jpg`,
});

const albums: UserGetTopAlbumsResponse = [
  album("first", 1),
  album("second", 2),
  album(undefined, 3),
];

let requests: Request[];

beforeEach(() => {
  requests = [];
  vi.mocked(userGetTopAlbums).mockResolvedValue(albums);
  server.use(
    http.get(`${origin}/_next/image`, ({ request }) => {
      requests.push(request);
      return HttpResponse.arrayBuffer(new ArrayBuffer(1));
    }),
  );
});

describe("warmCovers", () => {
  it("requests each period's covers once, as the collage renders them", async () => {
    warmCovers(origin);

    await vi.waitFor(() => expect(log.info).toHaveBeenCalled());
    expect(userGetTopAlbums).toHaveBeenCalledTimes(6);
    expect(requests.map(({ url }) => url.replace(origin, ""))).toEqual([
      coverSrc(`${cdn}/first.jpg`, 0),
      coverSrc(`${cdn}/second.jpg`, 1),
    ]);
    expect(requests[0]?.headers.get("accept")).toBe("image/webp");
  });

  it("logs a cover that fails to resize", async () => {
    server.use(
      http.get(
        `${origin}/_next/image`,
        () => new HttpResponse(null, { status: 504 }),
      ),
    );

    warmCovers(origin);

    await vi.waitFor(() =>
      expect(log.warn).toHaveBeenCalledWith(
        { path: coverSrc(`${cdn}/first.jpg`, 0), status: 504 },
        "Cover warm-up failed",
      ),
    );
  });

  it("logs a failed album list", async () => {
    const err = new Error("Last.fm is down");
    vi.mocked(userGetTopAlbums).mockRejectedValue(err);

    warmCovers(origin);

    await vi.waitFor(() =>
      expect(log.warn).toHaveBeenCalledWith({ err }, "Cover warm-up failed"),
    );
  });
});
