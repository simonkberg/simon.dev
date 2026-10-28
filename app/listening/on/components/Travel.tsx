"use client";

import type { Route } from "next";
import { useParams, useRouter } from "next/navigation";
import {
  createContext,
  type MouseEvent,
  type PropsWithChildren,
  use,
  useEffect,
  useRef,
  useState,
} from "react";

import type { Day } from "@/lib/dates";

// Served by the rewrite in next.config.ts, which typed routes don't read.
export const href = (day: Day) => `/listening/on/${day}` as Route;

/** Whether Link navigates on the click, rather than the browser opening a tab. */
export const isPlainClick = (event: MouseEvent) =>
  event.button === 0 &&
  !event.metaKey &&
  !event.ctrlKey &&
  !event.shiftKey &&
  !event.altKey;

interface Travel {
  /** The day in the URL, unchecked. */
  date: string | undefined;
  /** Where a drag or link is taking the page, until that day's page arrives. */
  target: Day | undefined;
  /** Moves to a day whose link is followed, before its page arrives. */
  travel: (to: Day, focused: boolean) => void;
  /** Moves to a day the tape is on; `held` waits for `release` to go there. */
  scrub: (to: Day, held: boolean) => void;
  release: () => void;
  /** Whether the day's link was focused when followed, so its new page's should be. */
  takeFocus: (day: Day) => boolean;
}

export const TravelContext = createContext<Travel>({
  date: undefined,
  target: undefined,
  travel: () => {},
  scrub: () => {},
  release: () => {},
  takeFocus: () => false,
});

// Long enough that holding an arrow key navigates once, where it stops.
const SCRUB_MS = 300;

/** Where the page is travelling, shared by the tape and what dims while it moves. */
export const TravelProvider = ({ children }: PropsWithChildren) => {
  const { month, day } = useParams<{ month?: string; day?: string }>();
  const date = month && day ? `${month}-${day}` : undefined;
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const scrubbed = useRef<Day>(undefined);
  const refocus = useRef<Day>(undefined);
  const [target, setTarget] = useState<Day>();
  // The day last asked for, so its arrival can tell itself from back or forward.
  const [sent, setSent] = useState<Day>();
  const [arrivals, setArrivals] = useState(0);
  const [shownDate, setShownDate] = useState(date);

  // The day asked for keeps a scrub begun while it loaded; any other drops it.
  if (date !== shownDate) {
    setShownDate(date);
    setSent(undefined);
    if (date !== sent) {
      setTarget(undefined);
      setArrivals((count) => count + 1);
    } else if (target === date) {
      setTarget(undefined);
    }
  }

  // A day reached another way (back, forward) wins over a pending scrub.
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      scrubbed.current = undefined;
    },
    [arrivals],
  );

  const release = () => {
    clearTimeout(timer.current);
    const to = scrubbed.current;
    scrubbed.current = undefined;
    if (to === undefined) return;
    setSent(to);
    router.replace(href(to), { scroll: false });
  };

  const scrub = (to: Day, held: boolean) => {
    clearTimeout(timer.current);
    refocus.current = undefined;
    // The shown day needs no page, so nothing is left to wait for.
    scrubbed.current = to === date ? undefined : to;
    setTarget(scrubbed.current);
    if (to === date && sent !== undefined) {
      // Staying is a navigation too, superseding the one still loading.
      setSent(undefined);
      router.replace(href(to), { scroll: false });
    } else if (!held) {
      timer.current = setTimeout(release, SCRUB_MS);
    }
  };

  const travel = (to: Day, focused: boolean) => {
    clearTimeout(timer.current);
    scrubbed.current = undefined;
    refocus.current = focused ? to : undefined;
    setSent(to);
    // Going to the shown day changes no `date`, so nothing else would let go.
    setTarget(to === date ? undefined : to);
  };

  const takeFocus = (to: Day) => {
    const take = refocus.current === to;
    if (take) refocus.current = undefined;
    return take;
  };

  return (
    <TravelContext value={{ date, target, travel, scrub, release, takeFocus }}>
      {children}
    </TravelContext>
  );
};

export interface TravelPendingProps extends PropsWithChildren {
  /** What the children show: the day, or its month. */
  of: "day" | "month";
}

/** Dims its children while the page travels away from what they show. */
export const TravelPending = ({ of, children }: TravelPendingProps) => {
  const { date, target } = use(TravelContext);
  const pending =
    target !== undefined &&
    (of === "day" || target.slice(0, 7) !== date?.slice(0, 7));
  return (
    <div className="time-travel-pending" data-pending={pending || undefined}>
      {children}
    </div>
  );
};
