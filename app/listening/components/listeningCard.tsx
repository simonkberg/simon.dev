"use no memo";

import {
  getDailyScrobbles,
  type GetScrobblesResult,
  type GetTopArtistByBucketResult,
  getScrobbles,
  getTopAlbums,
  getTopArtistByBucket,
  getTopArtists,
  type ScrobbleCount,
  type Span,
  type TopAlbum,
  type TopArtist,
} from "@/actions/listening";
import { inlineCover } from "@/lib/covers";
import { type Day, fullDayLabel, monthOf } from "@/lib/dates";
import { formatNumber, formatPlays } from "@/lib/formatNumber";
import { type Period, periodLabels } from "@/lib/periods";
import { bucketUnits } from "@/lib/scrobbleBuckets";
import { type Lane, lanes } from "@/lib/scrobbleChart";
import { color, Pane, shareCard, Stems } from "@/lib/shareCard";

const fullWidth = 940;
// The #1 cover, with #2–4 stacked beside it at a third of its height.
const coverSize = 300;
const coverGap = 9;
const stackSize = (coverSize - 2 * coverGap) / 3;
// What the full chart leaves its average label.
const coversGap = 107;
const coversWidth = coverSize + coverGap + stackSize;
// What the stats and the chart's average label leave before the covers.
const gutter = 24;
const laneHeight = 26;
// What fits under the chart; the most played, in order of first appearance.
const laneCount = 4;
// Iosevka's advance is half its size.
const laneFont = 16;

const Lanes = ({
  items,
  rows,
  width,
}: {
  items: readonly ScrobbleCount[];
  rows: readonly Lane[];
  width: number;
}) => {
  const step = width / items.length;
  return (
    <div style={{ display: "flex", flexDirection: "column", marginTop: 44 }}>
      {rows.map(({ name, runs, first }) => (
        <div
          key={name}
          style={{
            display: "flex",
            position: "relative",
            width,
            height: laneHeight,
            borderBottom: `1px dashed ${color.rule}`,
          }}
        >
          <span
            style={{
              position: "absolute",
              left: Math.min(
                step * first,
                width - (name.length * laneFont) / 2,
              ),
              top: 0,
              fontSize: laneFont,
            }}
          >
            {name}
          </span>
          {runs.map((run) => (
            <div
              key={run.first}
              style={{
                position: "absolute",
                left: step * run.first + 2,
                width: step * (run.last - run.first + 1) - 4,
                bottom: 3,
                height: 2,
                background: color.accent,
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
};

const ellipsis = {
  overflow: "hidden",
  whiteSpace: "nowrap",
  textOverflow: "ellipsis",
} as const;

// A long artist name gives way, so the row never runs into the covers.
const statSize = 19;
const totalSize = 32;
const nameSize = 25;
const statGap = 44;
const partGap = 10;

// Iosevka's advance is half its size.
const textWidth = (text: string, size: number) =>
  (Array.from(text).length * size) / 2;

const fit = (text: string, size: number, room: number) => {
  const chars = Array.from(text);
  const max = Math.max(1, Math.floor(room / (size / 2)));
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : text;
};

interface Labels {
  scrobbled: string;
  top: string;
}

const Stats = ({
  scrobbled,
  labels,
  top,
  width,
}: {
  scrobbled: number | undefined;
  labels: Labels;
  top: TopArtist | undefined;
  width: number;
}) => {
  const total = scrobbled === undefined ? undefined : formatNumber(scrobbled);
  const plays = top && formatNumber(top.playcount);
  // The top artist's name gives way, so the row never runs into the covers.
  const nameRoom =
    width -
    (total
      ? textWidth(total, totalSize) +
        textWidth(labels.scrobbled, statSize) +
        partGap +
        statGap
      : 0) -
    textWidth(`${labels.top} artist${plays}`, statSize) -
    2 * partGap;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: statGap,
        fontSize: statSize,
        whiteSpace: "nowrap",
        color: color.muted,
      }}
    >
      {total && (
        <span style={{ display: "flex", alignItems: "baseline", gap: partGap }}>
          <span
            style={{ fontSize: totalSize, fontWeight: 700, color: color.ink }}
          >
            {total}
          </span>
          {labels.scrobbled}
        </span>
      )}
      {top && (
        <span style={{ display: "flex", alignItems: "baseline", gap: partGap }}>
          {`${labels.top} artist`}
          <span
            style={{ fontSize: nameSize, fontWeight: 700, color: color.accent }}
          >
            {fit(top.name, nameSize, nameRoom)}
          </span>
          {plays}
        </span>
      )}
    </div>
  );
};

type CoverAlbum = TopAlbum & { image: string | undefined };

const Cover = ({ album, size }: { album: CoverAlbum; size: number }) => (
  <div
    style={{
      display: "flex",
      position: "relative",
      width: size,
      height: size,
      flexShrink: 0,
      border: `1px solid ${color.rule}`,
      ...(album.image && {
        backgroundImage: `url(${album.image})`,
        backgroundSize: "100% 100%",
      }),
    }}
  >
    <span
      style={{
        position: "absolute",
        left: -1,
        top: -1,
        padding: "1px 6px",
        fontSize: album.rank === 1 ? 16 : 13,
        fontWeight: 700,
        background: album.rank === 1 ? color.accent : color.ground,
        color: album.rank === 1 ? color.onAccent : color.ink,
      }}
    >
      {album.rank}
    </span>
  </div>
);

const Covers = ({
  albums: [first, ...rest],
  top,
}: {
  albums: CoverAlbum[];
  top: string;
}) =>
  first && (
    <div
      style={{ display: "flex", flexDirection: "column", width: coversWidth }}
    >
      <div style={{ display: "flex", gap: coverGap }}>
        <Cover album={first} size={coverSize} />
        <div
          style={{ display: "flex", flexDirection: "column", gap: coverGap }}
        >
          {rest.map((album) => (
            <Cover key={album.rank} album={album} size={stackSize} />
          ))}
        </div>
      </div>
      <span style={{ marginTop: 12, fontSize: 16, color: color.muted }}>
        {`${top} album · ${formatPlays(first.playcount)}`}
      </span>
      <span
        style={{ marginTop: 2, fontSize: 20, fontWeight: 700, ...ellipsis }}
      >
        {first.name}
      </span>
      <span
        style={{
          fontSize: 17,
          fontStyle: "italic",
          color: color.muted,
          ...ellipsis,
        }}
      >
        {first.artist}
      </span>
    </div>
  );

export const listeningAlt = "Scrobbles per day, week, month or year on Last.fm";

interface CardData {
  subtitle: string;
  // Whose top artist and albums the card shows.
  span: Span;
  scrobbles: Promise<GetScrobblesResult>;
  // What the stats count: every bar's scrobbles, or one bar's.
  scrobbled: (items: readonly ScrobbleCount[]) => number | undefined;
  labels: Labels;
  topArtistByBucket?: Promise<GetTopArtistByBucketResult>;
}

export const listeningCard = (period: Period) =>
  card({
    subtitle: `${periodLabels[period]} · per ${bucketUnits[period]}`,
    span: period,
    scrobbles: getScrobbles(period),
    scrobbled: (items) => items.reduce((sum, { count }) => sum + count, 0),
    labels: { scrobbled: "scrobbles", top: "top" },
    topArtistByBucket: getTopArtistByBucket(period),
  });

/** A time travel day: its month's days, with its own scrobbles counted. */
export const dayCard = (day: Day) =>
  card({
    subtitle: `${fullDayLabel(day)} · per day`,
    span: monthOf(day),
    scrobbles: getDailyScrobbles(monthOf(day)),
    scrobbled: (items) => items[Number(day.slice(8)) - 1]?.count,
    // The count is the day's, the tops its month's.
    labels: { scrobbled: "plays that day", top: "month's top" },
  });

async function card({
  subtitle,
  span,
  scrobbles: scrobblesResult,
  scrobbled,
  labels,
  topArtistByBucket: lanesResult,
}: CardData) {
  const [scrobbles, topArtistByBucket, topArtists, covers] = await Promise.all([
    scrobblesResult,
    lanesResult,
    getTopArtists(span),
    getTopAlbums(span).then((result) =>
      result.status === "ok"
        ? Promise.all(
            result.albums
              .slice(0, 4)
              .map(async (album, index) => ({
                ...album,
                image: album.cover && (await inlineCover(album.cover, index)),
              })),
          )
        : [],
    ),
  ]);
  const items = scrobbles.status === "ok" ? scrobbles.scrobbles : undefined;
  const top = topArtists.status === "ok" ? topArtists.artists[0] : undefined;
  const chartWidth = covers.length > 0 ? fullWidth - coversWidth : fullWidth;
  const rows =
    items && topArtistByBucket?.status === "ok"
      ? lanes(items, topArtistByBucket.buckets)
          .toSorted((a, b) => b.plays - a.plays)
          .slice(0, laneCount)
          .toSorted((a, b) => a.first - b.first)
      : [];

  return shareCard(
    { window: "listening" },
    <div style={{ display: "flex", flex: 1, padding: "40px 48px 36px" }}>
      <Pane number={1} title="Scrobbles" subtitle={subtitle}>
        <div style={{ display: "flex", gap: gutter }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              width: chartWidth + coversGap - gutter,
            }}
          >
            <Stats
              scrobbled={items && scrobbled(items)}
              labels={labels}
              top={top}
              width={chartWidth + coversGap - gutter}
            />
            {items ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  marginTop: 28,
                }}
              >
                <div style={{ display: "flex" }}>
                  <Stems
                    counts={items}
                    width={chartWidth}
                    height={170}
                    annotated
                  />
                </div>
                {rows.length > 0 && (
                  <Lanes items={items} rows={rows} width={chartWidth} />
                )}
              </div>
            ) : (
              <span style={{ marginTop: 28, fontSize: 21, color: color.muted }}>
                Scrobbles are temporarily unavailable :(
              </span>
            )}
          </div>
          <Covers albums={covers} top={labels.top} />
        </div>
      </Pane>
    </div>,
  );
}
