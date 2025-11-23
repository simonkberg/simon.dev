"use server";

import { cacheLife } from "next/cache";

import { getStats, type WakaTimeStats } from "@/lib/wakaTime";

export type WakaTimeStatsResult =
  | { status: "ok"; stats: WakaTimeStats }
  | { status: "error"; error: string };

export async function getWakaTimeStats(): Promise<WakaTimeStatsResult> {
  "use cache";

  try {
    const stats = await getStats();
    cacheLife("hours");
    return { status: "ok", stats };
  } catch (error) {
    cacheLife("seconds");
    console.error("Error fetching WakaTime stats:", error);
    return { status: "error", error: "Failed to fetch WakaTime stats" };
  }
}
