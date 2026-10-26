"use no memo";

import {
  getScrobbles,
  getTopAlbums,
  getTopArtistByBucket,
  getTopArtists,
  type ScrobbleCount,
  type TopAlbum,
  type TopArtist,
} from "@/actions/lastfm";
import { inlineCover } from "@/lib/covers";
import { formatNumber, formatPlays } from "@/lib/formatNumber";
import { type Period, periodLabels } from "@/lib/lastfm";
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

const Stats = ({
  items,
  top,
}: {
  items: readonly ScrobbleCount[] | undefined;
  top: TopArtist | undefined;
}) => (
  <div
    style={{
      display: "flex",
      alignItems: "baseline",
      gap: 44,
      fontSize: 19,
      color: color.muted,
    }}
  >
    {items && (
      <span style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <span style={{ fontSize: 32, fontWeight: 700, color: color.ink }}>
          {formatNumber(items.reduce((sum, { count }) => sum + count, 0))}
        </span>
        scrobbles
      </span>
    )}
    {top && (
      <span style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        top artist
        <span style={{ fontSize: 25, fontWeight: 700, color: color.accent }}>
          {top.name}
        </span>
        {formatNumber(top.playcount)}
      </span>
    )}
  </div>
);

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

const ellipsis = {
  overflow: "hidden",
  whiteSpace: "nowrap",
  textOverflow: "ellipsis",
} as const;

const Covers = ({ albums: [first, ...rest] }: { albums: CoverAlbum[] }) =>
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
        {`top album · ${formatPlays(first.playcount)}`}
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

export async function listeningCard(period: Period) {
  const [scrobbles, topArtistByBucket, topArtists, covers] = await Promise.all([
    getScrobbles(period),
    getTopArtistByBucket(period),
    getTopArtists(period),
    getTopAlbums(period).then((result) =>
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
    items && topArtistByBucket.status === "ok"
      ? lanes(items, topArtistByBucket.buckets)
          .toSorted((a, b) => b.plays - a.plays)
          .slice(0, laneCount)
          .toSorted((a, b) => a.first - b.first)
      : [];

  return shareCard(
    { window: "listening" },
    <div style={{ display: "flex", flex: 1, padding: "40px 48px 36px" }}>
      <Pane
        number={1}
        title="Scrobbles"
        subtitle={`${periodLabels[period]} · per ${bucketUnits[period]}`}
      >
        <div style={{ display: "flex", gap: coversGap }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <Stats items={items} top={top} />
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
          <Covers albums={covers} />
        </div>
      </Pane>
    </div>,
  );
}
