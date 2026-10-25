import { http, HttpResponse } from "msw";
import { expect, it } from "vitest";

import { REACTION_EMOJI } from "@/lib/emoji";
import { server } from "@/mocks/node";

import { loadShortcodes, reloadShortcodes } from "./shortcodes";

// One test, since the fetched set is kept for the page's lifetime.
it("falls back to the reactions when the set can't load, and retries on reload", async () => {
  server.use(
    http.get("*/api/emoji", () =>
      HttpResponse.json({ error: "Bad gateway" }, { status: 502 }),
    ),
  );

  expect(await loadShortcodes()).toEqual(
    REACTION_EMOJI.map(({ emoji, name }) => [emoji, [name], []]),
  );

  const skull = [["☠️", ["skull_crossbones"], []]];
  server.use(http.get("*/api/emoji", () => HttpResponse.json(skull)));

  expect(await reloadShortcodes()).toEqual(skull);
  expect(await reloadShortcodes()).toBe(await loadShortcodes());
});
