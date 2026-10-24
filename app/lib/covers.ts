import "server-only";
import { getImageProps } from "next/image";

import { config } from "@/config";
import { getGlobal } from "@/lib/global";
import { periods, TOP_ALBUMS, userGetTopAlbums } from "@/lib/lastfm";
import { log } from "@/lib/log";

const WARM_MS = 60 * 60 * 1000;
const WARM_CONCURRENCY = 2;

// One width per tile, so each cover is a single resize: `images.imageSizes` and `deviceSizes` hold their 2x.
export const coverWidth = (index: number) => (index === 0 ? 480 : 160);

export const coverSrc = (src: string, index: number) =>
  getImageProps({
    src,
    alt: "",
    width: coverWidth(index),
    height: coverWidth(index),
  }).props.src;

async function warmOnce(origin: string): Promise<void> {
  const lists = await Promise.all(
    periods.map((period) =>
      userGetTopAlbums(config.lastfmUsername, { period, limit: TOP_ALBUMS }),
    ),
  );
  const paths = new Set(
    lists.flatMap((albums) =>
      albums.flatMap(({ cover }, index) =>
        cover ? [coverSrc(cover, index)] : [],
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
