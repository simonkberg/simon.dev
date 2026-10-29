import Link from "next/link";
import { use } from "react";

import type { GetDiaryResult } from "@/actions/simonBot";
import { Skeleton } from "@/components/Skeleton";
import { fullDayLabel } from "@/lib/dates";

export interface DiaryTeaserProps {
  diary: Promise<GetDiaryResult>;
}

export const DiaryTeaser = ({ diary }: DiaryTeaserProps) => {
  const result = use(diary);
  const latest = result.status === "ok" ? result.data[0] : undefined;

  if (latest === undefined) return null;

  return (
    <div className="flashback">
      <strong className="flashback-title">
        simon-bot&apos;s diary,{" "}
        <time dateTime={latest.day}>{fullDayLabel(latest.day)}</time>
      </strong>
      <p>
        {latest.entry} See&nbsp;
        <Link href="/simon-bot#diary">every&nbsp;entry</Link>.
      </p>
    </div>
  );
};

export const DiaryTeaserSkeleton = () => (
  <div className="flashback" aria-hidden="true">
    <span className="flashback-title">
      <Skeleton width={24} />
    </span>
    <p>
      <Skeleton width={36} />
    </p>
  </div>
);
