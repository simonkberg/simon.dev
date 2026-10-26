import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { use } from "react";

import { isValidPeriod, type Period, periods } from "@/lib/lastfm";
import {
  ListeningPeriod,
  periodMetadata,
} from "@/listening/components/ListeningPeriod";

export const prefetch = "partial";
export const unstable_paramMatching = { period: "not-found" };
// Every valid period is prerendered, so reading params up front never blocks.
export const instant = false;

type ListeningPeriodPageProps = PageProps<"/listening/[period]">;

// All time is /listening itself.
const toPeriod = (param: string): Exclude<Period, "overall"> => {
  if (isValidPeriod(param) && param !== "overall") return param;
  notFound();
};

export async function generateMetadata({
  params,
}: ListeningPeriodPageProps): Promise<Metadata> {
  return periodMetadata(toPeriod((await params).period));
}

export function generateStaticParams(): Awaited<
  ListeningPeriodPageProps["params"]
>[] {
  return periods
    .filter((period) => period !== "overall")
    .map((period) => ({ period }));
}

export default function ListeningPeriodPage({
  params,
}: ListeningPeriodPageProps) {
  return <ListeningPeriod period={toPeriod(use(params).period)} />;
}
