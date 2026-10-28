import type { BucketTopArtist, ScrobbleCount } from "@/actions/listening";

// Labels count back from the current bucket. Narrow charts show every other one.
const labelStep = (count: number) => (count <= 8 ? 1 : Math.ceil(count / 6));

export const labelTick = (index: number, count: number) => {
  const fromEnd = count - 1 - index;
  const step = labelStep(count);
  if (fromEnd % (step * 2) === 0) return "narrow";
  if (fromEnd % step === 0) return "wide";
  return undefined;
};

export function stemStats(items: readonly ScrobbleCount[]) {
  const counts = items.map(({ count }) => count);
  // All-zero counts would scale the stems by 0/0.
  const max = Math.max(0, ...counts) || 1;
  // The current bucket is still filling up, so it would drag the average down.
  const settled = items.filter(({ current }) => !current);
  const average =
    settled.length > 0
      ? Math.round(
          settled.reduce((sum, { count }) => sum + count, 0) / settled.length,
        )
      : undefined;
  return { max, peak: counts.indexOf(max), average };
}

export interface Run {
  first: number;
  last: number;
}

export interface Lane {
  name: string;
  runs: (Run & { current: boolean })[];
  plays: number;
  first: number;
  last: number;
}

/** Each bucket's top artist, one lane per artist, in order of first appearance. */
export const lanes = (
  items: readonly ScrobbleCount[],
  buckets: readonly BucketTopArtist[],
): Lane[] => {
  // By label, in case the two loads straddle a new bucket.
  const artistOf = new Map(buckets.map(({ label, artist }) => [label, artist]));
  const byName = new Map<string, Lane>();
  items.forEach(({ label, current }, index) => {
    const topArtist = artistOf.get(label);
    if (!topArtist) return;
    const lane = byName.get(topArtist.name) ?? {
      name: topArtist.name,
      runs: [],
      plays: 0,
      first: index,
      last: index,
    };
    byName.set(topArtist.name, lane);
    lane.plays += topArtist.playcount;
    lane.last = index;
    const run = lane.runs.at(-1);
    if (run?.last === index - 1) {
      run.last = index;
      run.current = current;
    } else {
      lane.runs.push({ first: index, last: index, current });
    }
  });
  return [...byName.values()];
};
