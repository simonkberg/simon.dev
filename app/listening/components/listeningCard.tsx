"use no memo";

import {
  getScrobbles,
  getTopArtistByBucket,
  getTopArtists,
  type ScrobbleCount,
} from "@/actions/lastfm";
import { formatNumber } from "@/lib/formatNumber";
import { type Period, periodLabels } from "@/lib/lastfm";
import { bucketUnits } from "@/lib/scrobbleBuckets";
import { type Lane, lanes } from "@/lib/scrobbleChart";
import { color, Pane, shareCard, Stems } from "@/lib/shareCard";

const chartWidth = 940;
const laneHeight = 26;
// What fits under the chart; the most played, in order of first appearance.
const laneCount = 4;
// Iosevka's advance is half its size.
const laneFont = 16;

const Lanes = ({
  items,
  rows,
}: {
  items: readonly ScrobbleCount[];
  rows: readonly Lane[];
}) => {
  const step = chartWidth / items.length;
  return (
    <div style={{ display: "flex", flexDirection: "column", marginTop: 44 }}>
      {rows.map(({ name, runs, first }) => (
        <div
          key={name}
          style={{
            display: "flex",
            position: "relative",
            width: chartWidth,
            height: laneHeight,
            borderBottom: `1px dashed ${color.rule}`,
          }}
        >
          <span
            style={{
              position: "absolute",
              left: Math.min(
                step * first,
                chartWidth - (name.length * laneFont) / 2,
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

export const listeningAlt = "Scrobbles per day, week, month or year on Last.fm";

export async function listeningCard(period: Period) {
  const [scrobbles, topArtistByBucket, topArtists] = await Promise.all([
    getScrobbles(period),
    getTopArtistByBucket(period),
    getTopArtists(period),
  ]);
  const items = scrobbles.status === "ok" ? scrobbles.scrobbles : undefined;
  const top = topArtists.status === "ok" ? topArtists.artists[0] : undefined;
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
              <span
                style={{ fontSize: 25, fontWeight: 700, color: color.accent }}
              >
                {top.name}
              </span>
              {formatNumber(top.playcount)}
            </span>
          )}
        </div>
        {items ? (
          <div
            style={{ display: "flex", flexDirection: "column", marginTop: 28 }}
          >
            <div style={{ display: "flex" }}>
              <Stems counts={items} width={chartWidth} height={170} annotated />
            </div>
            {rows.length > 0 && <Lanes items={items} rows={rows} />}
          </div>
        ) : (
          <span style={{ marginTop: 28, fontSize: 21, color: color.muted }}>
            Scrobbles are temporarily unavailable :(
          </span>
        )}
      </Pane>
    </div>,
  );
}
