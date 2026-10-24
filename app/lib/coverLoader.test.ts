import { describe, expect, it } from "vitest";

import coverLoader from "./coverLoader";

const src = "https://lastfm.freetls.fastly.net/i/u/174s/abc.jpg";

describe("coverLoader", () => {
  it.each([
    [150, "174s"],
    [400, "500x500"],
    [3840, "770x0"],
  ])("serves %ipx from the smallest size covering it", (width, path) => {
    expect(coverLoader({ src, width })).toBe(
      `https://lastfm.freetls.fastly.net/i/u/${path}/abc.jpg`,
    );
  });
});
