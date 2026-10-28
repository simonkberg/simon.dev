import { cacheUntil } from "@/lib/cacheUntil";
import { clockTime, type Day, nextMidnight } from "@/lib/dates";

/** The Stockholm date at `now`, as "YYYY-MM-DD". */
export const localDay = (now: Date) => clockTime(now).slice(0, 10) as Day;

/** Today's Stockholm date, cached until its midnight. */
export async function getToday(): Promise<Day> {
  "use cache";
  const now = new Date();
  cacheUntil(nextMidnight(now).getTime(), now);
  return localDay(now);
}
