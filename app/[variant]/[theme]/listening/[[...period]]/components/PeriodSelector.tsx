import Link from "next/link";
import { objectEntries } from "ts-extras";

import { type Period, periodLabels } from "@/lib/lastfm";
import { route } from "@/lib/routes";

const periodsWithLabels = objectEntries(periodLabels);

export interface PeriodSelectorProps {
  current: Period;
}

export const PeriodSelector = ({ current }: PeriodSelectorProps) => (
  <menu>
    {periodsWithLabels.map(([period, label]) => (
      <li key={period} aria-current={current === period ? "page" : undefined}>
        {current === period ? (
          label
        ) : (
          <Link
            href={route(
              period === "overall" ? "/listening/" : `/listening/${period}`,
            )}
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
