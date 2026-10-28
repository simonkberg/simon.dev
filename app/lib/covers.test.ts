import { http, HttpResponse } from "msw";
import { cacheLife } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { config } from "@/config";
import { log } from "@/lib/log";
import { server } from "@/mocks/node";

import { coverUrls, inlineCover, warmCovers } from "./covers";

vi.mock(import("next/cache"), () => ({ cacheLife: vi.fn() }));

const origin = "http://localhost:3000";

const first = coverUrls(`${config.lastfmCoverCdn}first.jpg`, 0);
const second = coverUrls(`${config.lastfmCoverCdn}second.jpg`, 1);

// The collage's markup: each resize in a src and a srcset, its & escaped.
const page = (...covers: string[][]) =>
  covers
    .map(([x1, x2]) =>
      `<img srcset="${x1} 1x, ${x2} 2x" src="${x2}">`.replaceAll("&", "&amp;"),
    )
    .join("");

let requests: Request[];

beforeEach(() => {
  requests = [];
  server.use(
    http.get(`${origin}/listening`, () =>
      HttpResponse.html(page(first, second)),
    ),
    http.get(`${origin}/listening/:period`, () =>
      HttpResponse.html(page(first)),
    ),
    http.get(`${origin}/_next/image`, ({ request }) => {
      requests.push(request);
      return HttpResponse.arrayBuffer(new ArrayBuffer(1));
    }),
  );
});

describe("warmCovers", () => {
  it("requests every period page's covers once", async () => {
    warmCovers(origin);

    await vi.waitFor(() => expect(log.info).toHaveBeenCalled());
    expect(requests.map(({ url }) => url.replace(origin, "")).sort()).toEqual(
      [...first, ...second].sort(),
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
        { path: first[0], status: 504 },
        "Cover warm-up failed",
      ),
    );
  });

  it("keeps warming past a cover whose request fails", async () => {
    server.use(
      http.get(`${origin}/_next/image`, ({ request }) =>
        request.url.endsWith(first[0]!) ? HttpResponse.error() : undefined,
      ),
    );

    warmCovers(origin);

    await vi.waitFor(() => expect(log.info).toHaveBeenCalled());
    expect(log.warn).toHaveBeenCalledWith(
      { err: expect.any(Error), path: first[0] },
      "Cover warm-up failed",
    );
    expect(requests).toHaveLength(3);
  });

  it("warms the other pages past one that fails", async () => {
    server.use(
      http.get(
        `${origin}/listening`,
        () => new HttpResponse(null, { status: 500 }),
      ),
    );

    warmCovers(origin);

    await vi.waitFor(() => expect(log.info).toHaveBeenCalled());
    expect(log.warn).toHaveBeenCalledWith(
      { page: "/listening", status: 500 },
      "Cover warm-up failed",
    );
    expect(requests).toHaveLength(2);
  });

  it("warms the other pages past one that can't be reached", async () => {
    server.use(http.get(`${origin}/listening`, () => HttpResponse.error()));

    warmCovers(origin);

    await vi.waitFor(() => expect(log.info).toHaveBeenCalled());
    expect(log.warn).toHaveBeenCalledWith(
      { err: expect.any(Error), page: "/listening" },
      "Cover warm-up failed",
    );
    expect(requests).toHaveLength(2);
  });
});

describe("inlineCover", () => {
  const cover = `${config.lastfmCoverCdn}first.png`;

  it("inlines the 1x resize in the upload's own format", async () => {
    server.use(
      http.get(`${origin}/_next/image`, ({ request }) => {
        requests.push(request);
        return HttpResponse.arrayBuffer(new Uint8Array([1, 2, 3]).buffer, {
          headers: { "content-type": "image/png" },
        });
      }),
    );

    await expect(inlineCover(cover, 1)).resolves.toBe(
      "data:image/png;base64,AQID",
    );
    expect(requests.map(({ url }) => url.replace(origin, ""))).toEqual([
      coverUrls(cover, 1)[0],
    ]);
    expect(requests[0]?.headers.get("accept")).toBe("image/jpeg,image/png");
    expect(cacheLife).toHaveBeenCalledWith("hours");
  });

  it("caches a failed resize briefly", async () => {
    server.use(
      http.get(
        `${origin}/_next/image`,
        () => new HttpResponse(null, { status: 504 }),
      ),
    );

    await expect(inlineCover(cover, 0)).resolves.toBeUndefined();
    expect(cacheLife).toHaveBeenCalledWith("seconds");
    expect(log.warn).toHaveBeenCalledWith(
      { err: new Error("Cover responded 504"), path: coverUrls(cover, 0)[0] },
      "Cover inline failed",
    );
  });
});
