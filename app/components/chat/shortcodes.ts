import { type EmojiShortcodes, REACTION_EMOJI } from "@/lib/emoji";

const REACTION_SHORTCODES: EmojiShortcodes[] = REACTION_EMOJI.map(
  ({ emoji, name }) => [emoji, [name], []],
);

let shortcodes: Promise<EmojiShortcodes[]> | undefined;
let failed = false;

/** Fetched after the chat hydrates, so the full set never ships with the page; the same promise every call, so it is safe to `use()`. */
export function loadShortcodes(): Promise<EmojiShortcodes[]> {
  shortcodes ??= fetch("/api/emoji", {
    priority: "low",
    signal: AbortSignal.timeout(10_000),
  })
    .then((response) => {
      if (!response.ok) throw new Error(String(response.status));
      return response.json() as Promise<EmojiShortcodes[]>;
    })
    .catch(() => {
      failed = true;
      return REACTION_SHORTCODES;
    });
  return shortcodes;
}

/** Loads the set, retrying a fetch that failed; for an explicit event like focus, never render. */
export function reloadShortcodes(): Promise<EmojiShortcodes[]> {
  if (failed) {
    failed = false;
    shortcodes = undefined;
  }
  return loadShortcodes();
}
