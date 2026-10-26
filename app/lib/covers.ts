import "server-only";
import { cacheLife } from "next/cache";
import { getImageProps } from "next/image";

import { config } from "@/config";
import { getGlobal } from "@/lib/global";
import { periods, TOP_ALBUMS, userGetTopAlbums } from "@/lib/lastfm";
import { log } from "@/lib/log";

const WARM_MS = 60 * 60 * 1000;
const WARM_CONCURRENCY = 2;
const WARM_TIMEOUT_MS = 30_000;
const INLINE_TIMEOUT_MS = 10_000;

// This replica's own server, whose image cache the warm-up fills.
export const localOrigin = `http://localhost:${process.env["PORT"] ?? 3000}`;

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

// Satori refuses to fetch from localhost, so a share card gets the resize inline.
export async function inlineCover(
  src: string,
  index: number,
): Promise<string | undefined> {
  "use cache";

  // The 1x resize: a card is drawn at its own size.
  const [path] = coverUrls(src, index);
  try {
    const res = await fetch(new URL(String(path), localOrigin), {
      // Satori draws no WebP backgrounds, so this keeps the upload's own format.
      headers: { accept: "image/jpeg,image/png" },
      signal: AbortSignal.timeout(INLINE_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`Cover responded ${res.status}`);
    }
    const image = await res.blob();
    const data = Buffer.from(await image.arrayBuffer()).toString("base64");
    cacheLife("hours");
    return `data:${image.type};base64,${data}`;
  } catch (err) {
    cacheLife("seconds");
    log.warn({ err, path }, "Cover inline failed");
    return undefined;
  }
}

async function warmPath(origin: string, path: string): Promise<void> {
  try {
    const res = await fetch(new URL(path, origin), {
      headers: { accept: "image/webp" },
      signal: AbortSignal.timeout(WARM_TIMEOUT_MS),
    });
    await res.arrayBuffer();
    if (!res.ok) {
      log.warn({ path, status: res.status }, "Cover warm-up failed");
    }
  } catch (err) {
    log.warn({ err, path }, "Cover warm-up failed");
  }
}

async function warmOnce(origin: string): Promise<void> {
  const lists = await Promise.allSettled(
    periods.map((period) =>
      userGetTopAlbums(config.lastfmUsername, { period, limit: TOP_ALBUMS }),
    ),
  );
  const paths = new Set(
    lists.flatMap((list, index) => {
      if (list.status === "rejected") {
        log.warn(
          { err: list.reason, period: periods[index] },
          "Cover warm-up failed",
        );
        return [];
      }
      return list.value.flatMap(({ cover }, rank) =>
        cover ? coverUrls(cover, rank) : [],
      );
    }),
  );
  const queue = [...paths];
  const worker = async () => {
    for (let path = queue.shift(); path; path = queue.shift()) {
      await warmPath(origin, path);
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
