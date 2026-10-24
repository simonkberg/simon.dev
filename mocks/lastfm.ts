import type { TopAlbum } from "@/actions/lastfm";

export const coverCdn = "https://lastfm-img.freetls.fastly.net/i/u";

export const topAlbum = (
  name: string,
  artist: string,
  rank: number,
  cover?: string,
): TopAlbum => ({
  name,
  artist,
  playcount: 40 - rank,
  rank,
  url: `https://www.last.fm/music/${artist.replaceAll(" ", "+")}/${name.replaceAll(" ", "+")}`,
  cover,
});
