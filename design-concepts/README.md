# Redesign concepts

Static mock-ups of every page (home, listening, 404, error) in three directions.
The markup mirrors the React components and the content is real, captured from
simon.dev; each concept is one stylesheet over it.

| Concept    | Idea                                                                                                                                                             |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Manual** | The site as a man page. Section names in caps, body indented, troff-style header and footer lines. Bold, underline and reverse video only.                       |
| **Ledger** | A label column and a content column, a large name, one cobalt accent. WakaTime percentages as segmented bars, the chat as a plain live panel.                    |
| **Panes**  | A tmux session, dark first. Status line with a window per page, sections as panes titled in their border; the pane under the pointer or holding focus lights up. |

All three follow `prefers-color-scheme` and work down to phone width.

## Unified

`unified/` is all three from one markup and one stylesheet. The rules in
`unified/style.css` read only custom properties; a variant is the block that sets
them (`:root[data-variant="…"]`), and no rule outside those blocks names a variant.
Colours are `light-dark()` pairs, so `color-scheme` or `data-theme` picks the palette.

- `data-variant` on `<html>` selects the variant; Panes is the default.
- The footer switcher sets it and saves a `variant` cookie. A small inline script
  in `<head>` reads the cookie before first paint, so the server renders the same
  static page for everyone.
- About 215 variables; a variant sets 80–115 of them, the rest keep the default.
  Structural choices are variables too: grid templates, `position`, generated
  `content` (the `(1)` after links, the chat's `live` label, reply glyphs).

Compared with the three originals, pixel for pixel up to the footer, the
differences are:

- The footer (switcher, and Manual's colophon on every page) now appears on every
  page in every variant.
- Manual's header reads `SIMON KJELLBERG(1)`, not `SIMON-KJELLBERG(1)`: the name
  is one piece of shared markup. Its centre label reads `Not-Found` on the 404.
- Ledger's period label sits on its own line at phone width, as intended; the
  original's cascade kept it inline.
- Reduced motion now stops animations in all three (it was Ledger only).

## Viewing

Serve the repository root (the pages load the Iosevka files from `app/assets/`):

```sh
python3 -m http.server
# http://localhost:8000/design-concepts/unified/index.html
```

`shared/preview.js` stands in for the chat's client code (reply, cancel with Esc,
dismiss the tip, send; `/error` shows the error toast) and adds a theme switch.

`python3 design-concepts/build.py` regenerates the pages and formats them with oxfmt; `--viewer out.html` also
writes a single-file viewer with subset fonts inlined (needs `fonttools` and `brotli`).

## Structural changes they need

Shared by all three:

- `StatsList`: wrap the name and percentage in `.label` / `.value` spans and pass
  `--value` (and `--max` on the list) as custom properties.
- `RecentTracksList`: a `now-playing` class on the "(Now playing)" subtitle.
- `PeriodSelector`: `aria-current="page"` on the current period.

Per concept:

- **Manual**: `Header` gets centre and right cells; the footer gets a colophon line.
- **Ledger**: `Header` splits the section out of the link into a `.path` span.
- **Panes**: `Header` gains the page list (`0:home`, `1:listening`) and the location.
