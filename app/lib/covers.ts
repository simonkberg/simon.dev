import "server-only";
import { cacheLife } from "next/cache";
import { getImageProps } from "next/image";

import { getGlobal } from "@/lib/global";
import { log } from "@/lib/log";
import { periods } from "@/lib/periods";

// The listening page shows this many, as a #1 tile beside a 3×3 grid.
export const TOP_ALBUMS = 10;

const WARM_MS = 60 * 60 * 1000;
const WARM_CONCURRENCY = 2;
const WARM_TIMEOUT_MS = 30_000;
const INLINE_TIMEOUT_MS = 10_000;
// A failed resize is random per request, so the same one is asked for again.
const INLINE_RETRY_MS = [1_000, 3_000];

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

async function fetchResize(path: string, retries = INLINE_RETRY_MS) {
  const res = await fetch(new URL(path, localOrigin), {
    // Satori draws no WebP backgrounds, so this keeps the upload's own format.
    headers: { accept: "image/jpeg,image/png" },
    signal: AbortSignal.timeout(INLINE_TIMEOUT_MS),
  });
  if (res.ok) return res.blob();
  const [wait, ...rest] = retries;
  if (wait === undefined) throw new Error(`Cover responded ${res.status}`);
  await new Promise((resolve) => setTimeout(resolve, wait));
  return fetchResize(path, rest);
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
    const image = await fetchResize(String(path));
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

const periodPages = periods.map((period) =>
  period === "overall" ? "/listening" : `/listening/${period}`,
);

// The page's own render picks the covers, from its cached lists: "use cache" can't run outside a request.
async function coverPaths(origin: string, page: string): Promise<string[]> {
  try {
    const res = await fetch(new URL(page, origin), {
      signal: AbortSignal.timeout(WARM_TIMEOUT_MS),
    });
    const html = await res.text();
    if (!res.ok) {
      log.warn({ page, status: res.status }, "Cover warm-up failed");
      return [];
    }
    return [...html.matchAll(/\/_next\/image\?[^"\s,]+/g)].map(([path]) =>
      path.replaceAll("&amp;", "&"),
    );
  } catch (err) {
    log.warn({ err, page }, "Cover warm-up failed");
    return [];
  }
}

async function warmOnce(origin: string): Promise<void> {
  const pages = await Promise.all(
    periodPages.map((page) => coverPaths(origin, page)),
  );
  const paths = new Set(pages.flat());
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
    // Every request logs its own failure, so a run never rejects.
    const run = () => void warmOnce(origin);
    run();
    return setInterval(run, WARM_MS).unref();
  });
}
