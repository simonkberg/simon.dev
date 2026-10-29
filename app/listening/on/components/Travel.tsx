"use client";

import { useParams, useRouter } from "next/navigation";
import {
  createContext,
  type PropsWithChildren,
  startTransition,
  use,
  useEffect,
  useOptimistic,
  useReducer,
  useRef,
} from "react";

import { type Day, monthOf } from "@/lib/dates";

import { href } from "../href";

interface Travel {
  /** The day in the URL, unchecked. */
  date: string | undefined;
  /** Where a drag or link is taking the page, until that day's page arrives. */
  target: Day | undefined;
  /** The day a followed link or let-go drag is loading, which a new drag keeps the date of. */
  going: Day | undefined;
  /** Follows a day's link, in place of Link's own navigation. */
  travel: (event: { preventDefault: () => void }, to: Day) => void;
  /** Moves to a day the tape is on; `held` waits for `release` to go there. */
  scrub: (to: Day, held: boolean) => void;
  release: () => void;
}

export const TravelContext = createContext<Travel>({
  date: undefined,
  target: undefined,
  going: undefined,
  travel: () => {},
  scrub: () => {},
  release: () => {},
});

// Long enough that holding an arrow key navigates once, where it stops.
const SCRUB_MS = 300;

/** Where the page is travelling, shared by the tape and what dims while it moves. */
export const TravelProvider = ({ children }: PropsWithChildren) => {
  const { year, month, day } = useParams<{
    year?: string;
    month?: string;
    day?: string;
  }>();
  const date = year && month && day ? `${year}-${month}-${day}` : undefined;
  const router = useRouter();
  // The day being loaded, for as long as its navigation is.
  const [going, setGoing] = useOptimistic<Day | undefined>(undefined);
  // Where the tape is, until it is sent; the ref for the timer and drag to read.
  const [scrubbing, dispatchScrub] = useReducer(
    (
      _: Day | undefined,
      action: { type: "scrub"; to: Day } | { type: "settle" },
    ) => (action.type === "scrub" ? action.to : undefined),
    undefined,
  );
  const scrubbed = useRef<Day>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const sent = useRef<Day>(undefined);
  const heading = going ?? date;
  const shown = scrubbing ?? going;

  const settle = () => {
    clearTimeout(timer.current);
    scrubbed.current = undefined;
    dispatchScrub({ type: "settle" });
  };

  // A day reached another way (back, forward) wins over a scrub not yet sent.
  useEffect(() => {
    if (date !== sent.current) settle();
    sent.current = undefined;
  }, [date]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const go = (to: Day) => {
    settle();
    sent.current = to;
    startTransition(() => {
      setGoing(to);
      router.replace(href(to), { scroll: false });
    });
  };

  const release = () => {
    if (scrubbed.current !== undefined) go(scrubbed.current);
  };

  const scrub = (to: Day, held: boolean) => {
    if (to === heading) return settle();
    clearTimeout(timer.current);
    scrubbed.current = to;
    dispatchScrub({ type: "scrub", to });
    if (!held) timer.current = setTimeout(release, SCRUB_MS);
  };

  const travel: Travel["travel"] = (event, to) => {
    event.preventDefault();
    if (to === heading) settle();
    else go(to);
  };

  return (
    <TravelContext
      value={{
        date,
        target: shown === date ? undefined : shown,
        going,
        travel,
        scrub,
        release,
      }}
    >
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
    (of === "day" || monthOf(target) !== date?.slice(0, 7));
  return (
    <div className="time-travel-pending" data-pending={pending || undefined}>
      {children}
    </div>
  );
};
