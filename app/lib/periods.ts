export const periods = [
  "7day",
  "1month",
  "3month",
  "6month",
  "12month",
  "overall",
] as const;

export type Period = (typeof periods)[number];

export const periodLabels = {
  "7day": "7 days",
  "1month": "1 month",
  "3month": "3 months",
  "6month": "6 months",
  "12month": "1 year",
  overall: "all time",
} as const satisfies Record<Period, string>;

export function isValidPeriod(value: unknown): value is Period {
  return periods.includes(value as Period);
}
