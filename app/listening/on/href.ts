import type { Route } from "next";

import type { Day } from "@/lib/dates";

// Typed routes can't tell that a date's slices hold no slash.
export const href = (day: Day) =>
  `/listening/on/${day.replaceAll("-", "/")}` as Route;
