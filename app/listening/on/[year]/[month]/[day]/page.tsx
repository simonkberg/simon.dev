// Async, which the React Compiler would turn into a component it can't call outside a render.
"use no memo";

import type { Metadata } from "next";

import { getDayPlays } from "@/actions/listening";
import { Heading } from "@/components/Heading";
import { Subtitle } from "@/components/Subtitle";
import { storedTake } from "@/lib/commentary";
import { fullDayLabel } from "@/lib/dates";
import { formatPlays } from "@/lib/formatNumber";
import { getToday } from "@/lib/today";
import { Commentary } from "@/listening/components/Commentary";

import { toDay } from "../../../toDay";
import { DayPlays } from "./components/DayPlays";

export const prefetch = "partial";
// Blocks on the day, so the day before stays on screen until this one is ready.
export const instant = false;

type TimeTravelPageProps = PageProps<"/listening/on/[year]/[month]/[day]">;

// Cache Components needs one day to prerender: the first scrobbles.
export function generateStaticParams() {
  return [{ day: "18" }];
}

export async function generateMetadata({
  params,
}: TimeTravelPageProps): Promise<Metadata> {
  const day = await toDay(await params);
  return {
    title: `Listening - ${fullDayLabel(day)}`,
    description: `What I played on ${fullDayLabel(day)}, from Last.fm`,
  };
}

export default async function TimeTravelPage({ params }: TimeTravelPageProps) {
  const day = await toDay(await params);
  const result = await getDayPlays(day);
  const plays = result.status === "ok" ? result.plays : undefined;

  return (
    <>
      <Commentary page={day} stored={storedTake(day)} today={getToday()} />
      <section>
        <Heading level={2}>
          That Day{" "}
          <Subtitle>
            ({fullDayLabel(day)}
            {plays && ` · ${formatPlays(plays.length)}`})
          </Subtitle>
        </Heading>
        <DayPlays plays={plays} />
      </section>
    </>
  );
}
