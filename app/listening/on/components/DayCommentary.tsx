"use client";

import { use } from "react";

import type { Day } from "@/lib/dates";
import { Commentary } from "@/listening/components/Commentary";

import { TravelContext } from "./Travel";

// In the layout, so it sits under the tape's pane, and keyed so each day asks afresh.
export function DayCommentary({ today }: { today: Promise<Day> }) {
  const { date } = use(TravelContext);
  return date === undefined ? null : (
    <Commentary key={date} page={date} today={today} />
  );
}
