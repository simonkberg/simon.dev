import { cacheUntil } from "@/lib/cacheUntil";
import { type Day, localDay, nextMidnight } from "@/lib/dates";

/** Today's Stockholm date, cached until its midnight. */
export async function getToday(): Promise<Day> {
  "use cache";
  const now = new Date();
  cacheUntil(nextMidnight(now).getTime(), now);
  return localDay(now);
}
