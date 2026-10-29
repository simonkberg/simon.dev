import { use } from "react";

import type { GetOnThisDayResult } from "@/actions/listening";
import { Flashback, FlashbackSkeleton } from "@/components/Flashback";
import { formatPlays } from "@/lib/formatNumber";
import { busiestYear } from "@/lib/onThisDay";

export interface OnThisDayTeaserProps {
  onThisDay: Promise<GetOnThisDayResult>;
}

export const OnThisDayTeaser = ({ onThisDay }: OnThisDayTeaserProps) => {
  const result = use(onThisDay);
  const year =
    result.status === "ok" ? busiestYear(result.days.years) : undefined;

  if (year === undefined) return null;

  return (
    <Flashback
      title={`On this day in ${year.year} (${formatPlays(year.count)})`}
      href="/listening/on-this-day"
      more={"every\u00a0year"}
    >
      {year.top.track} &ndash; <em>{year.top.artist}</em>.
    </Flashback>
  );
};

export const OnThisDayTeaserSkeleton = () => (
  <FlashbackSkeleton titleWidth={16} />
);
