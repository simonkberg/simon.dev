import Link from "next/link";
import { objectEntries } from "ts-extras";

import { type Period, periodLabels } from "@/lib/lastfm";

const periodsWithLabels = objectEntries(periodLabels);

export interface PeriodSelectorProps {
  current: Period;
}

export const PeriodSelector = ({ current }: PeriodSelectorProps) => (
  <menu aria-label="Period">
    {periodsWithLabels.map(([period, label]) => (
      <li key={period} aria-current={current === period ? "page" : undefined}>
        {current === period ? (
          label
        ) : (
          <Link
            href={`/listening/${period === "overall" ? "" : period}`}
            prefetch
            replace
          >
            {label}
          </Link>
        )}
      </li>
    ))}
  </menu>
);
