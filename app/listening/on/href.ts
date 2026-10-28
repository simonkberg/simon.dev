import type { Route } from "next";

import type { Day } from "@/lib/dates";

// Typed routes can't tell that a date's slices hold no slash.
export const href = (day: Day) =>
  `/listening/on/${day.slice(0, 4)}/${day.slice(5, 7)}/${day.slice(8)}` as Route;
