import { notFound } from "next/navigation";

import { isValidPeriod, type Period } from "@/lib/lastfm";

// All time is /listening itself.
export function toPeriod(param: string): Exclude<Period, "overall"> {
  if (isValidPeriod(param) && param !== "overall") return param;
  notFound();
}
