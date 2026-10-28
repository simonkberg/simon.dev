import type { Metadata } from "next";
import { use } from "react";

import { periods } from "@/lib/periods";
import {
  ListeningPeriod,
  periodMetadata,
} from "@/listening/components/ListeningPeriod";

import { toPeriod } from "./toPeriod";

export const prefetch = "partial";
export const unstable_paramMatching = { period: "not-found" };
// Every valid period is prerendered, so reading params up front never blocks.
export const instant = false;

type ListeningPeriodPageProps = PageProps<"/listening/[period]">;

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
