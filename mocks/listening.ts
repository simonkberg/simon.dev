import type { TopAlbum } from "@/actions/listening";

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
