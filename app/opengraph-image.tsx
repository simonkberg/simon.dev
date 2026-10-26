import { getRecentTracks, getScrobbles } from "@/actions/lastfm";
import { config } from "@/config";
import { formatNumber } from "@/lib/formatNumber";
import { color, shareCard, Stems } from "@/lib/shareCard";

export { contentType, size } from "@/lib/shareCard";

export const alt = `${config.title}, fullstack engineer in Stockholm`;

export default async function openGraphImage() {
  const [recentTracks, scrobbles] = await Promise.all([
    getRecentTracks(),
    getScrobbles("overall"),
  ]);
  const track =
    recentTracks.status === "ok" ? recentTracks.tracks[0] : undefined;
  const counts = scrobbles.status === "ok" ? scrobbles.scrobbles : undefined;

  return shareCard(
    { window: "home", title: "home" },
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        padding: "56px 48px 76px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 36,
          fontSize: 84,
          fontWeight: 700,
          lineHeight: 1,
        }}
      >
        <span style={{ color: color.accent, fontSize: 56 }}>◆</span>
        {config.title.toLowerCase()}
      </div>
      <div
        style={{
          marginTop: 28,
          maxWidth: 860,
          fontSize: 27,
          lineHeight: 1.45,
          color: color.muted,
        }}
      >
        Fullstack engineer, specialized in React, Node.js and Java. Senior
        engineer at Spotify, Stockholm.
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          marginTop: "auto",
        }}
      >
        {track && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span
              style={{ fontSize: 17, letterSpacing: 1.4, color: color.muted }}
            >
              {track.nowPlaying ? "NOW PLAYING" : "LAST PLAYED"}
            </span>
            <span style={{ display: "flex", gap: 12, fontSize: 22 }}>
              <span style={{ color: color.accent }}>›</span>
              <span>{`${track.name} –`}</span>
              <span style={{ fontStyle: "italic" }}>{track.artist}</span>
            </span>
          </div>
        )}
        {counts && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              gap: 10,
              marginLeft: "auto",
            }}
          >
            <Stems counts={counts} width={360} height={120} />
            <span style={{ fontSize: 15, color: color.muted }}>
              {`${formatNumber(counts.reduce((sum, { count }) => sum + count, 0))} scrobbles since ${config.lastfmSince}`}
            </span>
          </div>
        )}
      </div>
    </div>,
  );
}
