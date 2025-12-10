import { z } from "zod";

export const periods = [
  "last_7_days",
  "last_30_days",
  "last_year",
  "all_time",
] as const;

export type Period = (typeof periods)[number];

const DEFAULT_PERIOD: Period = "last_7_days";
const BASE_URL = "https://wakatime.com/share/@simonkberg";
const STATS_URLS: Record<Period, string> = {
  last_7_days: "b2bb44ec-d8bd-42ee-ad9d-8948172388d0.json",
  last_30_days: "2daa8cdd-2a7e-4deb-836f-b913a308a93a.json",
  last_year: "bdbe1607-6d0d-418c-aa98-9602535e8f6b.json",
  all_time: "b65f0e73-704a-44ce-9538-eee4fc913be8.json",
};

const wakaTimeStatSchema = z
  .object({ name: z.string(), percent: z.number() })
  .readonly();
const wakaTimeStatsSchema = z.array(wakaTimeStatSchema).readonly();
const wakaTimeStatsResponseSchema = z
  .object({ data: wakaTimeStatsSchema })
  .readonly();

export type WakaTimeStats = z.infer<typeof wakaTimeStatsSchema>;

export async function getStats(
  period: Period = DEFAULT_PERIOD,
  limit = 15,
): Promise<WakaTimeStats> {
  if (!(period in STATS_URLS)) {
    throw new Error(`Invalid period: ${period}`);
  }
  const res = await fetch(`${BASE_URL}/${STATS_URLS[period]}`, {
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) {
    throw new Error(`WakaTime API error: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  return wakaTimeStatsResponseSchema.parse(data).data.slice(0, limit);
}
