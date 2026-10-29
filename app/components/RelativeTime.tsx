"use client";

import { useReducer, useSyncExternalStore } from "react";

import { TooltipText } from "@/components/Tooltip";
import { useTimeout } from "@/components/useTimeout";

const second = 1000;
const minute = 60 * second;
const hour = 60 * minute;
const day = 24 * hour;
const month = 30 * day;
const year = 365 * day;

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

type Style = "long" | "short" | "narrow";

const createRtf = (style: Style) =>
  new Intl.RelativeTimeFormat("en", { numeric: "auto", style });

const formats: Record<Style, Intl.RelativeTimeFormat> = {
  long: createRtf("long"),
  short: createRtf("short"),
  narrow: createRtf("narrow"),
};

export interface RelativeTimeProps {
  date: Date;
  /** @defaultValue "long" */
  style?: Style;
}

const subscribe = () => () => {};

function tickEvery(elapsed: number) {
  if (elapsed > day) return undefined;
  if (elapsed < 2 * minute) return second;
  if (elapsed < hour) return minute;
  return 5 * minute;
}

export const RelativeTime = ({ date, style = "long" }: RelativeTimeProps) => {
  const [now, tick] = useReducer(
    (_: number, at: number) => at,
    undefined,
    Date.now,
  );
  const hydrating = useSyncExternalStore(
    subscribe,
    () => false,
    () => true,
  );
  const relativeTime = now - date.getTime();
  const elapsed = Math.abs(relativeTime);
  const sign = Math.sign(-relativeTime);
  const rtf = formats[style];

  useTimeout(() => tick(Date.now()), tickEvery(elapsed), elapsed);

  let string: string;

  if (elapsed < minute) {
    string = rtf.format(sign * Math.round(elapsed / second), "second");
  } else if (elapsed < hour) {
    string = rtf.format(sign * Math.round(elapsed / minute), "minute");
  } else if (elapsed < day) {
    string = rtf.format(sign * Math.round(elapsed / hour), "hour");
  } else if (elapsed < month) {
    string = rtf.format(sign * Math.round(elapsed / day), "day");
  } else if (elapsed < year) {
    string = rtf.format(sign * Math.round(elapsed / month), "month");
  } else {
    string = rtf.format(sign * Math.round(elapsed / year), "year");
  }

  return (
    <TooltipText tooltip={dateTimeFormat.format(date)}>
      {/* The server's clock wrote the hydrated text: keep it, then remount with ours. */}
      <time
        key={String(hydrating)}
        dateTime={date.toISOString()}
        suppressHydrationWarning
      >
        {string}
      </time>
    </TooltipText>
  );
};
