import { cacheLife } from "next/cache";

/** Caches a `"use cache"` result until `end`, or for at most `maxSeconds`. */
export function cacheUntil(end: number, now: Date, maxSeconds = Infinity) {
  const revalidate = Math.min(
    maxSeconds,
    Math.ceil((end - now.getTime()) / 1000),
  );
  cacheLife({ stale: 300, revalidate, expire: revalidate + 86_400 });
}
