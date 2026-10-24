import "server-only";
import { getImageProps } from "next/image";

import { config } from "@/config";
import { getGlobal } from "@/lib/global";
import { periods, TOP_ALBUMS, userGetTopAlbums } from "@/lib/lastfm";
import { log } from "@/lib/log";

const WARM_MS = 60 * 60 * 1000;
const WARM_CONCURRENCY = 2;

// A fixed width gives each cover just a 1x and a 2x URL to warm.
export const coverWidth = (index: number) => (index === 0 ? 480 : 160);

export function coverUrls(src: string, index: number): string[] {
  const { srcSet } = getImageProps({
    src,
    alt: "",
    width: coverWidth(index),
    height: coverWidth(index),
  }).props;
  return String(srcSet)
    .split(", ")
    .map((candidate) => candidate.slice(0, candidate.lastIndexOf(" ")));
}

async function warmOnce(origin: string): Promise<void> {
  const lists = await Promise.all(
    periods.map((period) =>
      userGetTopAlbums(config.lastfmUsername, { period, limit: TOP_ALBUMS }),
    ),
  );
  const paths = new Set(
    lists.flatMap((albums) =>
      albums.flatMap(({ cover }, index) =>
        cover ? coverUrls(cover, index) : [],
      ),
    ),
  );
  const queue = [...paths];
  const worker = async () => {
    for (let path = queue.shift(); path; path = queue.shift()) {
      const res = await fetch(new URL(path, origin), {
        headers: { accept: "image/webp" },
      });
      await res.arrayBuffer();
      if (!res.ok) {
        log.warn({ path, status: res.status }, "Cover warm-up failed");
      }
    }
  };
  await Promise.all(Array.from({ length: WARM_CONCURRENCY }, worker));
  log.info({ count: paths.size }, "Warmed album covers");
}

// The image cache is per replica and starts empty, and a cold cover can take seconds, so resize them before visitors do.
export function warmCovers(origin: string): void {
  getGlobal("cover-warm-up", () => {
    const run = () =>
      warmOnce(origin).catch((err: unknown) => {
        log.warn({ err }, "Cover warm-up failed");
      });
    void run();
    return setInterval(run, WARM_MS).unref();
  });
}
