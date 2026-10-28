import Link from "next/link";
import { objectEntries } from "ts-extras";

import { type Period, periodLabels } from "@/lib/periods";

type Tab = Period | "on-this-day";

const tabs: readonly (readonly [Tab, string])[] = [
  ...objectEntries(periodLabels),
  ["on-this-day", "on this day"],
];

export interface PeriodSelectorProps {
  current: Tab;
}

export const PeriodSelector = ({ current }: PeriodSelectorProps) => (
  <menu aria-label="Period">
    {tabs.map(([tab, label]) => (
      <li key={tab} aria-current={current === tab ? "page" : undefined}>
        {current === tab ? (
          label
        ) : (
          <Link
            href={tab === "overall" ? "/listening" : `/listening/${tab}`}
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
