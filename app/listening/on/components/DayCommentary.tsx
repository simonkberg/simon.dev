"use client";

import { use } from "react";

import { Commentary } from "@/listening/components/Commentary";

import { TravelContext } from "./Travel";

// In the layout, so it sits in the tape's pane, and keyed so each day asks afresh.
export function DayCommentary() {
  const { date } = use(TravelContext);
  return date === undefined ? null : <Commentary key={date} page={date} />;
}
