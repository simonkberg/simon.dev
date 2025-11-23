"use server";

import { cacheLife } from "next/cache";

import { log } from "@/lib/log";
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
  } catch (err) {
    cacheLife("seconds");
    log.error(
      { err, action: "getWakaTimeStats" },
      "Error fetching WakaTime stats",
    );
    return { status: "error", error: "Failed to fetch WakaTime stats" };
  }
}
