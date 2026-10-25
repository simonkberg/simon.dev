import { describe, expect, it } from "vitest";

import { type EmojiShortcodes, REACTION_EMOJI } from "@/lib/emoji";

import { GET } from "./route";

const shortcodes = (): Promise<EmojiShortcodes[]> => GET().json();

describe("GET /api/emoji", () => {
  it("lets browsers keep the list, since a static route alone only sends s-maxage", () => {
    expect(GET().headers.get("Cache-Control")).toBe(
      "public, max-age=86400, stale-while-revalidate=604800",
    );
  });

  it("names each emoji by JoyPixels' shortcode first", async () => {
    const emoji = await shortcodes();

    expect(emoji.find(([emoji]) => emoji === "💀")?.[1]).toEqual([
      "skull",
      "skeleton",
    ]);
    expect(emoji.find(([emoji]) => emoji === "🙃")?.[1][0]).toBe("upside_down");
  });

  it("knows every reaction by its picker name", async () => {
    const emoji = new Map(
      (await shortcodes()).map(([emoji, names]) => [emoji, names]),
    );

    for (const { emoji: reaction, name } of REACTION_EMOJI) {
      expect(emoji.get(reaction)).toContain(name);
    }
  });

  it("leaves out skin tones and other components", async () => {
    const emoji = (await shortcodes()).map(([emoji]) => emoji);

    expect(emoji).not.toContain("🏽");
    expect(emoji).not.toContain("🇸");
  });

  it("drops flags' bare country codes", async () => {
    const flag = (await shortcodes()).find(([emoji]) => emoji === "🇸🇪");

    expect(flag?.[1]).toContain("flag_se");
    expect(flag?.[1]).not.toContain("se");
  });

  it("keeps only the keywords a search can match", async () => {
    const emoji = await shortcodes();
    const keywords = emoji.flatMap(([, , keywords]) => keywords);

    expect(emoji.find(([emoji]) => emoji === "😂")?.[2]).toContain("lol");
    expect(keywords).not.toContain("i’m");
    expect(keywords).not.toContain("SE");
  });
});
