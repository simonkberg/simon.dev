"use no memo";

import { type DayInYear, getOnThisDay } from "@/actions/lastfm";
import { formatPlays } from "@/lib/formatNumber";
import { busiestYear } from "@/lib/onThisDay";
import { color, Pane, shareCard } from "@/lib/shareCard";

export { contentType, size } from "@/lib/shareCard";

export const alt = "What I played on this day in past years, from Last.fm";

const width = 1000;
const height = 230;
// What the tallest stem leaves above it for its artist.
const labelRoom = 150;
const marker = 10;
const labelFont = 15;
const labelLine = 18;
// Long names give way first; the rest of the line keeps its width.
const clip = {
  flexShrink: 1,
  overflow: "hidden",
  textOverflow: "ellipsis",
} as const;
const keep = { flexShrink: 0 };

const Timeline = ({
  years,
  busiest,
}: {
  years: readonly DayInYear[];
  busiest: DayInYear | undefined;
}) => {
  const max = Math.max(1, ...years.map(({ count }) => count));
  const step = width / years.length;
  return (
    <div
      style={{
        display: "flex",
        position: "relative",
        width,
        height: height + 30,
        fontSize: labelFont,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: height,
          width,
          borderTop: `1px solid ${color.rule}`,
        }}
      />
      {years.map(({ year, count, top }, index) => {
        const x = step * index + step / 2;
        const stem = 20 + (count / max) * (height - labelRoom - 20);
        const isBusiest = top && year === busiest?.year;
        const labelWidth = height - stem - 14;
        return (
          <div key={year} style={{ display: "flex" }}>
            {top ? (
              <>
                <div
                  style={{
                    position: "absolute",
                    left: x - 1,
                    top: height - stem,
                    height: stem,
                    width: 2,
                    background: color.accent,
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    left: x - marker / 2,
                    top: height - stem - marker / 2,
                    width: marker,
                    height: marker,
                    transform: "rotate(45deg)",
                    border: `1.5px solid ${color.accent}`,
                    background: isBusiest ? color.ground : color.accent,
                  }}
                />
                {/* Rotated about its centre, so it ends just above the marker. */}
                <span
                  style={{
                    position: "absolute",
                    left: x - labelWidth / 2,
                    top: labelWidth / 2 - labelLine / 2,
                    width: labelWidth,
                    height: labelLine,
                    lineHeight: `${labelLine}px`,
                    transform: "rotate(-90deg)",
                    ...clip,
                    whiteSpace: "nowrap",
                    color: isBusiest ? color.ink : color.muted,
                  }}
                >
                  {top.artist}
                </span>
              </>
            ) : (
              <div
                style={{
                  position: "absolute",
                  left: x - 0.5,
                  top: height - 10,
                  height: 10,
                  borderLeft: `1px dashed ${color.muted}`,
                }}
              />
            )}
            {(top || Number(year) % 3 === 0) && (
              <span
                style={{
                  position: "absolute",
                  left: x - 30,
                  width: 60,
                  justifyContent: "center",
                  top: height + 10,
                  color: top ? color.ink : color.muted,
                }}
              >
                {`’${year.slice(2)}`}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default async function openGraphImage() {
  const result = await getOnThisDay();
  const days = result.status === "ok" ? result.days : undefined;
  // Oldest first, along the time axis.
  // Before reversing, so a tie goes to the newest year, as on the home page.
  const busiest = busiestYear(days?.years ?? []);
  const years = days?.years.toReversed() ?? [];
  const played = years.filter(({ top }) => top).length;

  return shareCard(
    { window: "listening" },
    <div style={{ display: "flex", flex: 1, padding: "40px 48px 36px" }}>
      <Pane
        number={1}
        title="On this day"
        subtitle={`${played} of ${years.length} years`}
      >
        {days ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <span style={{ fontSize: 64, fontWeight: 700, lineHeight: 1 }}>
                {days.date}
              </span>
              {busiest && (
                <div
                  style={{
                    display: "flex",
                    gap: 12,
                    fontSize: 22,
                    color: color.muted,
                    whiteSpace: "nowrap",
                  }}
                >
                  <span style={keep}>busiest:</span>
                  <span style={{ ...keep, color: color.accent }}>
                    {busiest.year}
                  </span>
                  <span style={keep}>·</span>
                  <span style={{ ...clip, color: color.ink }}>
                    {busiest.top.track}
                  </span>
                  <span style={keep}>–</span>
                  <span style={{ ...clip, fontStyle: "italic" }}>
                    {busiest.top.artist}
                  </span>
                  <span style={keep}>·</span>
                  <span style={keep}>{formatPlays(busiest.count)}</span>
                </div>
              )}
            </div>
            <Timeline years={years} busiest={busiest} />
          </div>
        ) : (
          <span style={{ fontSize: 21, color: color.muted }}>
            This day in past years is temporarily unavailable :(
          </span>
        )}
      </Pane>
    </div>,
  );
}
