import { http, HttpResponse } from "msw";
import { getImageProps } from "next/image";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { userGetTopAlbums } from "@/lib/lastfm";
import { log } from "@/lib/log";
import { coverCdn, topAlbum } from "@/mocks/lastfm";
import { server } from "@/mocks/node";

import { coverUrls, warmCovers } from "./covers";

vi.mock(import("next/image"), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getImageProps: vi.fn(actual.getImageProps) };
});

vi.mock(import("@/lib/lastfm"), async (importOriginal) => ({
  ...(await importOriginal()),
  userGetTopAlbums: vi.fn(),
}));

const origin = "http://localhost:3000";

const albums = [
  topAlbum("first", "Artist", 1, `${coverCdn}/first.jpg`),
  topAlbum("second", "Artist", 2, `${coverCdn}/second.jpg`),
  topAlbum("third", "Artist", 3),
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
    expect(requests.map(({ url }) => url.replace(origin, "")).sort()).toEqual(
      [
        ...coverUrls(`${coverCdn}/first.jpg`, 0),
        ...coverUrls(`${coverCdn}/second.jpg`, 1),
      ].sort(),
    );
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
        { path: coverUrls(`${coverCdn}/first.jpg`, 0)[0], status: 504 },
        "Cover warm-up failed",
      ),
    );
  });

  it("keeps warming past a cover whose request fails", async () => {
    const [failing] = coverUrls(`${coverCdn}/first.jpg`, 0);
    server.use(
      http.get(`${origin}/_next/image`, ({ request }) =>
        request.url.endsWith(failing!) ? HttpResponse.error() : undefined,
      ),
    );

    warmCovers(origin);

    await vi.waitFor(() => expect(log.info).toHaveBeenCalled());
    expect(log.warn).toHaveBeenCalledWith(
      { err: expect.any(Error), path: failing },
      "Cover warm-up failed",
    );
    expect(requests).toHaveLength(3);
  });

  it("warms the other periods past a failed album list", async () => {
    const err = new Error("Last.fm is down");
    vi.mocked(userGetTopAlbums).mockRejectedValueOnce(err);

    warmCovers(origin);

    await vi.waitFor(() => expect(log.info).toHaveBeenCalled());
    expect(log.warn).toHaveBeenCalledWith(
      { err, period: "7day" },
      "Cover warm-up failed",
    );
    expect(requests).toHaveLength(4);
  });

  it("logs a warm-up that throws", async () => {
    const err = new Error("Invalid image");
    vi.mocked(getImageProps).mockImplementationOnce(() => {
      throw err;
    });

    warmCovers(origin);

    await vi.waitFor(() =>
      expect(log.warn).toHaveBeenCalledWith({ err }, "Cover warm-up failed"),
    );
  });
});
