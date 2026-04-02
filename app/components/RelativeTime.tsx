"use client";

import { useEffect, useState } from "react";

const second = 1000;
const minute = 60 * second;
const hour = 60 * minute;
const day = 24 * hour;
const month = 30 * day;
const year = 365 * day;

const createRtf = (options: Intl.RelativeTimeFormatOptions) =>
  new Intl.RelativeTimeFormat("en", { numeric: "auto", ...options });

export interface RelativeTimeProps {
  date: Date;
  /** @defaultValue "long" */
  style?: "long" | "short" | "narrow";
}

export const RelativeTime = ({ date, style = "long" }: RelativeTimeProps) => {
  const [now, setNow] = useState(Date.now);
  const relativeTime = now - date.getTime();
  const elapsed = Math.abs(relativeTime);
  const sign = Math.sign(-relativeTime);
  const [rtf, setRtf] = useState(() => createRtf({ style }));
  const [prevStyle, setPrevStyle] = useState(style);

  if (style !== prevStyle) {
    setPrevStyle(style);
    setRtf(createRtf({ style }));
  }

  useEffect(() => {
    if (elapsed > day) return;

    const timer = setTimeout(
      () => setNow(Date.now()),
      elapsed < 2 * minute ? second : elapsed < hour ? minute : 5 * minute,
    );
    return () => clearTimeout(timer);
  }, [elapsed]);

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
    <time dateTime={date.toISOString()} title={date.toLocaleString()}>
      {string}
    </time>
  );
};
