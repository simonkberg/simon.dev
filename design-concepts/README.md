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

## Viewing

Serve the repository root (the pages load the Iosevka files from `app/assets/`):

```sh
python3 -m http.server
# http://localhost:8000/design-concepts/manual/index.html
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
