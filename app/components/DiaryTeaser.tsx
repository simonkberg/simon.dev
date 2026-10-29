import { use } from "react";

import type { GetDiaryResult } from "@/actions/simonBot";
import { Flashback, FlashbackSkeleton } from "@/components/Flashback";
import { fullDayLabel } from "@/lib/dates";

export interface DiaryTeaserProps {
  diary: Promise<GetDiaryResult>;
}

export const DiaryTeaser = ({ diary }: DiaryTeaserProps) => {
  const result = use(diary);
  const latest = result.status === "ok" ? result.data[0] : undefined;

  if (latest === undefined) return null;

  return (
    <Flashback
      title={
        <>
          simon-bot&apos;s diary,{" "}
          <time dateTime={latest.day}>{fullDayLabel(latest.day)}</time>
        </>
      }
      href="/simon-bot#diary"
      more={"every\u00a0entry"}
    >
      {latest.entry}
    </Flashback>
  );
};

export const DiaryTeaserSkeleton = () => <FlashbackSkeleton titleWidth={24} />;
