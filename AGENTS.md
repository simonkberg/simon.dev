<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AGENTS.md

This file provides guidance to AI coding agents when working with code in this repository.

> `CLAUDE.md` is a symlink to this file (`AGENTS.md`) for compatibility with Claude Code.

## Project Overview

This is a personal website built with Next.js 16 (App Router) that integrates with Discord for real-time chat functionality, WakaTime for coding statistics, and Last.fm for recently played music. The site is deployed as a standalone Docker container on Railway.

## Requirements

- Node.js 24
- Corepack enabled

If Corepack is not enabled, run `corepack enable` before installing dependencies.

## Development Commands

- `pnpm dev` - Start Next.js development server with Turbopack
- `pnpm build` - Build production bundle (requires all environment variables)
- `pnpm start` - Start production server
- `pnpm lint` - Run TypeScript, Oxlint, and Oxfmt checks
- `pnpm lint:fix` - Auto-fix Oxlint and Oxfmt issues
- `pnpm test` - Run tests (auto-detects TTY; no `CI=true` prefix needed)
- `pnpm test --coverage` - Run tests with coverage report

> **Prefer `pnpm lint` and `pnpm lint:fix`** over individual commands (`lint:tsc`, `lint:oxlint`, `lint:oxfmt`). They run all checks in parallel and complete in seconds.

> **Lint and test need no env vars.** `pnpm typegen` sets `SKIP_ENV_VALIDATION` itself; a bare `next typegen` (or `next build`) fails on the Zod env check because `next.config.ts` imports `app/lib/env.ts`.

### MCP Tools

MCP servers are configured in `.mcp.json`:

- `next-devtools` — Next.js MCP tools (`nextjs_docs` for docs lookup, `nextjs_call` for app state)

### Docker

- Build: `docker build -t simon.dev .`
- Run: `docker run -p 3000:3000 simon.dev`
- Force clean build: `docker build --no-cache -t simon.dev .`

BuildKit cache mounts are used for pnpm store and Next.js build cache. Build args are used for secrets since Railway doesn't support secret mounts.

### Railway

Service config lives in `.railway/railway.ts` (Railway IaC). Deploys don't read it;
`.github/workflows/railway-config.yml` plans it for `production` and `testing` on PRs (see the
job summary) and applies it to both on merge. An apply that would delete something fails
there and needs a hand `pnpm exec railway config apply --environment <env>`. `testing` never runs;
it's the template PR previews copy when a PR opens, so previews of a PR that changes the
config still run the old one.

Each preview gets its own Turso database: `.github/workflows/preview-database.yml` forks
testing's as `simondev-pr-<N>` when a PR opens and deletes it on close. Testing's
`TURSO_DATABASE_URL` holds `{environment}`, which `env.ts` fills from `RAILWAY_ENVIRONMENT_NAME`,
and its `TURSO_AUTH_TOKEN` is a group token, so it reaches every fork.

Variables are `managed`, so a new env var must be added there too or apply deletes it. Don't
set `builder`: Railway doesn't store it, so the plan never settles.

## Directory Structure

All source lives in `app/` (App Router); test mocks in `mocks/`.

**Convention:** Route-specific components live in `{route}/components/` rather than `app/components/`.

## Configuration

### Path Aliases

- `@/*` → `app/*`
- `@/mocks/*` → `mocks/*`

### Next.js Config

Key settings in `next.config.ts`:

- `output: "standalone"` — self-contained build for Docker deployment
- `cacheComponents: true` — Next.js 16 Cache Components
- `reactCompiler: true` — React Compiler (auto-memoization)
- `typedRoutes: true` — type-safe `<Link>` hrefs
- `experimental: { turbopackRustReactCompiler: true }` — native (Rust) React Compiler inside Turbopack

> **`/` keeps cached data out of its static shell** by chaining the `"use cache"` calls on
> `io()`, so the shell has no revalidate time and never goes stale. When a partially
> prerendered page's shell is stale, Next regenerates it inside the next Server Action request
> and re-runs the action handler on the already-consumed body. That logs "Unexpected end of
> JSON input" with a digest, fails no request, and leaves the shell stale until a GET
> regenerates it. With `getRecentTracks` in the shell it went stale every minute, so every
> action hit it. Only reproduces with real data in the prerender.

### Typed Routes

For optional catch-all routes like `[[...param]]`, use a trailing slash to link to the base path (e.g., `/listening/` not `/listening`).

### Lint and Format Config

Oxlint (`oxlint.config.ts`) lints, Oxfmt (`oxfmt.config.ts`) formats, and they never
overlap — no stylistic rules are enabled, and import sorting is Oxfmt's. The non-obvious
choices are commented in place.

**Fix the diagnostic; don't suppress it.** The codebase has no `oxlint-disable` comments
and shouldn't gain any — a rule firing where it shouldn't usually means the code can be
written so the rule is satisfied honestly. Reach for the fix the rule's `help` line
suggests, and if you cannot find one, raise it rather than silencing it.

### Environment Variables

Validation via Zod in `app/lib/env.ts`. Required variables:

| Variable             | Description                                                        |
| -------------------- | ------------------------------------------------------------------ |
| `SESSION_SECRET`     | Session encryption (auto-defaults to "unsafe_dev_secret" in dev)   |
| `DISCORD_BOT_TOKEN`  | Discord bot token                                                  |
| `DISCORD_GUILD_ID`   | Discord guild ID                                                   |
| `DISCORD_CHANNEL_ID` | Discord channel ID                                                 |
| `LAST_FM_API_KEY`    | Last.fm API key                                                    |
| `ANTHROPIC_API_KEY`  | Anthropic API key for simon-bot                                    |
| `TURSO_DATABASE_URL` | Turso database URL (`libsql://` or `turso://`), the only datastore |
| `TURSO_AUTH_TOKEN`   | Turso auth token                                                   |

Set `SKIP_ENV_VALIDATION=true` to skip validation (used in CI/Docker).

To rotate `SESSION_SECRET`, move its value to the optional `SESSION_SECRET_PREVIOUS` and set a
new one: sessions signed with either verify, and `proxy.ts` re-signs each visitor's with the
new one. Unset the previous once "Session verified with SESSION_SECRET_PREVIOUS" stops logging.

`NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` is a Docker build arg, not validated by Zod: pin it in
Railway so server action references stay valid across redeploys.
`NEXT_DEPLOYMENT_ID` comes from Railway's `RAILWAY_DEPLOYMENT_ID` build arg, so a tab on an
older deploy reloads on its next navigation instead of mixing in the new deploy's chunks.

## Architecture

Integrations live in `app/lib/` — Discord (REST + Gateway WebSocket, streamed to clients
from `app/api/chat/sse/`), WakaTime, Last.fm and Anthropic. The non-obvious parts:

- **Discord:** reads come from `ChannelStore` (`app/lib/discord/store.ts`), one per process:
  the latest 100 messages, fetched over REST on a new gateway session and kept current by
  its events. Renders call Discord only for what a session hasn't seen yet: a name not on
  an event's `member` (looked up once per session) and who reacted to a seeded reaction
  (once). Otherwise only a reply chain reaching past the window, search and writes use
  REST, where a rate-limit "gate" per route (every route on a global 429) prevents
  retry storms. Messages from the site carry a `username: content` prefix for attribution.
- **Chat stream:** `ChatStream` (in the chat's title bar) owns the SSE connection and shows
  its state: `live`, `connecting` or `offline`. The route sends a named `status` event when
  the gateway behind it drops or recovers, so an open stream alone doesn't read as live.
  Each change, batched with any in the next 150ms, makes tabs `router.refresh()`, served from history cached per store revision.
- **Presence:** an open chat stream counts its visitor as here: one Turso `presence` row per
  stream. A replica's heartbeat is the only writer of its streams' rows: it runs on every open
  and close and each 15s, upserts the open ones, deletes the closed ones until that succeeds,
  drops rows unseen for 45s and reads back everyone (`app/lib/presence.ts`). The server only
  notices a closed stream when a write fails, so the stream pings every 5s. Discord members
  who are `online` or `dnd` join the names, tracked per replica from the gateway like typing
  (`app/lib/discord/online.ts`, started at boot: Discord lists who is online only as a session
  starts), and the tooltip names simon-bot without counting it.
- **Typing:** Discord's `TYPING_START` reaches every replica, so each tracks typists itself
  (`app/lib/discord/typing.ts`), by chat name since the bot posts for every visitor, until
  Discord's 10s run out or they post. simon-bot sends Discord's typing while it composes; the
  bot types for nothing else, so a bot typist is simon-bot.
  Site visitors' typing can't come from Discord, since the bot posts for them: the input pings
  `/api/chat/typing` every 2s while a message is typed, never with its text, and each ping keeps
  a Turso `typing` row 4s, or until they post or clear it (`app/lib/siteTyping.ts`). With no pub/sub, a
  replica with open streams reads the table each second.
- **Reactions:** one Turso row per visitor in `reactions`; the bot mirrors them on Discord
  with its own reaction while any remain, so Discord shows site reactions as one. History
  adds those rows to Discord's counts minus the bot's; the page marks the visitor's own as
  `mine`, since the cached history is shared. Other tabs refresh only when the channel
  changes, so a toggle that leaves the mirror unchanged reaches them on the next change. Mirror
  failures and races only show on Discord, so they are logged, not retried; a clear on Discord leaves the site's rows. simon-bot
  reacts the same way, as a `simon-bot` row, since its Discord reaction is the mirror.
  Each skin tone is its own reaction, but a pill groups an emoji's tones, as Slack does:
  clicking it takes back the visitor's own in any tone, or adds theirs in their tone. A user
  holds one tone per emoji: `addReaction` drops their others once the new one is mirrored.
- **Session:** `proxy.ts` mints a visitor's session and also forwards it on the request,
  so `getSession()` finds one on every page and action the matcher covers, first visit included.
- **Emoji shortcodes:** typing `:` in the chat input suggests emoji from `/api/emoji`, a static
  route built from `emojibase-data` with JoyPixels' names first, the closest to Discord's, and
  Emojibase's keywords, which Discord matches too (whole, after every shortcode). It is
  fetched when the input takes focus, a shortcode is typed or a message emoji or reaction is
  first hovered, which shows its shortcode, so the full set never ships with the page;
  `app/components/chat/shortcodes.ts` holds the one cached request.
  Sending turns known `:shortcodes:` into emoji (`emojify`, called from `postChannelMessage`), as
  Discord clients do: the one place they convert, so the input never rewrites what is typed.
  The reaction picker's ✋ sets one skin tone per visitor, for its emoji and the suggestions
  (`app/components/chat/skinTone.ts`), kept in localStorage rather than a cookie since it never
  changes the server render.
- **Chat commands:** a leading `/` in the chat input runs a command from
  `app/components/chat/commands.ts` instead of posting; `//` sends one slash. They run in the
  browser (`/whoami` and `/forget` through a server action, on simon-bot's `people/<username>`
  notes) and print their output above the input for that visitor only, never to Discord. The
  input suggests them as it does `:` shortcodes, from the same combobox (`ChatSuggestInput`).
- **WakaTime:** reads a public share URL, so there is no API key. 3s timeout; Last.fm 10s.
- **Scrobble charts:** Last.fm has no stats endpoint, so the listening page counts each
  Stockholm calendar day, week, month or year with `user.getRecentTracks`'s `total` (one track per
  page): a request per bar. Lanes under it follow each bar's top artist from
  `user.getWeeklyArtistChart`, which takes any range, not just Last.fm's weeks: another request
  per bar, cached apart so a failure only drops the lanes. A bar an hour past its end is cached
  on its own for a day, so the hourly chart refetches only recent bars, and the chart regenerates
  as its current bar ends. These fan-outs go through `bulk()` (`app/lib/lastfm.ts`), at most four
  at once; a nested cache returns its error rather than throwing, since a throw fails the prerender.
- **Album covers:** Next's image optimiser resizes each Last.fm cover from its original
  upload (the CDN path without a size segment): the CDN's own resized sizes 404 in some
  regions. A cold resize can take seconds and the image cache is per replica, so each tile
  has a fixed width, a 1x and a 2x URL (`coverWidth` in `app/lib/covers.ts`), and
  `instrumentation.ts` warms every period's covers at boot and hourly. Each look filters the
  covers with properties that transition, so hover or focus fades them to the original from
  one image: manual dithers by adding a Bayer grain under a `contrast()` threshold, since a
  `url()` filter can't interpolate.
- **On this day:** `/listening/on-this-day`, a tab beside the periods, reads today's Stockholm
  date in each past year with one `getRecentTracks` page per year; the home page teases the
  busiest year through the same cached call.
- **Readiness:** `/health` answers 503 with the pending stages until `instrumentation.ts`
  has marked both in `app/lib/readiness.ts`: migrations applied and the bot on the gateway.
  Railway polls it at deploy time, so a replica that cannot reach Turso or Discord never
  takes traffic and the previous deploy keeps serving. Migrations retry with backoff until
  they apply, so a Turso blip at boot delays a deploy instead of failing it. The bot starts
  only after, since it hears Discord before the replica takes traffic.
- **Logging:** pino (`app/lib/log.ts`), one JSON line per entry so Railway indexes it.
  `instrumentation.ts` bridges `console.*` into it, so Next's own errors (and its
  `NEXT_PRIVATE_DEBUG_CACHE` output) arrive structured too; `LOG_LEVEL` filters both.
- **simon-bot:** `app/lib/anthropic.ts` calls Claude Haiku 5.5 (adaptive thinking, `medium` effort for replies,
  `high` for reflection) with raw `fetch`, no SDK; a "simon-bot" mention triggers it. It starts once at
  server boot from `instrumentation.ts` — one long-lived Gateway subscription, not
  per-request — and dedupes replies and mentions through Turso's `seen_messages` (kept an hour) so multiple
  instances don't double-reply. Without Turso it doesn't reply at all, rather than twice.
  Every environment's site posts as the bot, and PR previews share a channel, so each post
  carries a per-environment `nonce` and the bot answers a site post only where it was sent.
  The reply chain reaches it as one user turn of escaped `<message>` elements, its own
  included, so ids, authors and reactions sit outside the text people can type.
  `get_chat_history` returns the same elements, and the conversation carries today's Stockholm
  date, kept out of the system prompt so its cache holds. Tool schemas use `io: "input"`, so
  defaulted fields aren't listed as required.
  A reply's last round rules out tools, so it ends in text rather than running out of rounds.
- **Turso:** the only datastore. `app/lib/turso.ts` calls its HTTP pipeline endpoint with raw
  `fetch`; `batch()` sends several statements in one request and one transaction. Once
  migrations apply, `instrumentation.ts` runs `keepWarm()`, a `SELECT 1` each
  minute, since idle Turso stalls the next query past its timeout. `app/lib/migrations.ts`
  is an append-only list of statements applied at boot under a lock row in `locks`, each
  in one transaction with its record. Each records a checksum, and boot fails if an applied
  one was edited: change the schema with a new migration. Chat posts are rate limited by `app/lib/rateLimit.ts`,
  a sliding window kept atomic across replicas by doing the count and insert in one statement.
  It fails open: a limiter error lets the post through. It remembers blocked keys in memory,
  so a flood is turned away without database round trips. Before it, `app/lib/ipDenyList.ts`
  turns away IPs on ipsum's `levels/6.txt`, an in-memory set loaded at boot, refreshed daily
  and retried from a minute up to hourly; until a list loads it denies nobody.
- **simon-bot memory:** `app/lib/memory.ts` owns the `memories` table and renders the
  `<memory>` system-prompt block: `self`, `style`, `interests`, `context` and `people/<username>` for
  the current participants in full, every other category as a name and count the bot reads
  with `recall`. Notes are one line. `edit` and `forget` are compare-and-swap on the note's text. Memory
  failures degrade to a reply without memory, never to no reply. `/simon-bot` shows the
  `self`, `style` and `interests` notes to visitors; `context` and `people/*` stay private.
- **simon-bot self:** the bot's `self` and `style` notes are its personality and voice; the
  base prompt in `app/lib/anthropic.ts` carries a starting point they take precedence over.
  `app/lib/reflection.ts` runs after every mention, even one the bot chose not to answer,
  fire-and-forget, with only the memory tools, so bookkeeping never delays a response.
  Every API turn logs its stop reason, block types, usage and summarized thinking, so a
  silent turn can be read back from the logs. Simon is recognised by his username: site
  visitors get generated names, so only his own Discord messages appear as "simon".

## Patterns

### Comments

**Don't write comments by default.** A comment that restates the code goes stale and earns
nothing; if a block needs prose to follow, extract a function or rename a variable instead.
Keep one only when it explains _why_ — a workaround, a non-obvious constraint, a deliberate
deviation someone would otherwise "fix". One short line.

### Server Actions

All in `app/actions/`, marked `"use server"`, returning a discriminated union on `status`
(`"ok"` with `data`, `"error"` with `error`).

### Caching with `"use cache"`

Place `cacheLife()` conditionally—only one should execute per invocation:

```typescript
export async function getData(): Promise<Result> {
    "use cache";
    try {
        const data = await fetchData();
        cacheLife("hours"); // Success: cache longer
        return { status: "ok", data };
    } catch {
        cacheLife("seconds"); // Error: cache briefly
        return { status: "error", error: "Failed" };
    }
}
```

Use `"minutes"` for frequently-changing data (recent tracks), `"hours"` for aggregated data (top tracks).

### Promise Props with `use()` Hook

Components take `Promise<T>` props and unwrap them with `use()`. Always wrap the call site
in `<Suspense>`. Lists and tables export a `*Skeleton` beside them for the fallback, built on
their own markup so each variant styles it; chat keeps `Loader`.

### Page Metadata

- Root layout template: `%s - Simon Kjellberg`
- Subpages only set `title: "PageName"`
- `global-error.tsx` must set its full title manually (doesn't inherit the template)
- 404s use `not-found.tsx`, not `global-not-found.tsx`: that one is a separate root layout, so
  `<Link>`s out of it change the URL but not the page

### Tooltips

Use `TooltipButton` from `app/components/Tooltip.tsx`, not `title`: a manual popover anchored to
its button that opens on hover, keyboard focus or a long press on touch. `TooltipText` is the
inline-text kind, used for emoji in messages and timestamps: hover (after `delay`, by default like
`title`; the scrobble chart's is 0) or tap, never a tab stop. Tooltip content that loads goes in
`WhenShown`, so it waits for the first show.

### Server-Only Code

Files that must not run on client import `"server-only"` at top (e.g., `app/lib/discord/api.ts`, `app/lib/discord/gateway.ts`, `app/lib/session.ts`).

## Testing

- **Environment:** happy-dom
- **Location:** Co-located with source files (`*.test.ts`, `*.test.tsx`)
- **Mocking:** MSW in `mocks/node.ts` (configured in `vitest.setup.ts`), env vars in `mocks/env.ts`, cookies in `mocks/headers.ts`, reduced motion in `mocks/matchMedia.ts`, a settled promise for server renders in `mocks/promise.ts`, top albums in `mocks/lastfm.ts`, the mocked gateway's listener in `mocks/gateway.ts`, Turso in `mocks/sqlite.ts` (in-memory `node:sqlite`; pass it `MIGRATIONS` for the schema; mock `@/lib/turso` with `mockTurso()` so `batch` runs through `query`); happy-dom has no popover API, so `vitest.setup.ts` stubs `showPopover`/`hidePopover` to toggle `data-popover-open`; it also spies every `log` level before each test, so logs never print and tests assert with `expect(log.warn)` without their own spy
- **React Compiler:** enabled in `vitest.config.ts` via `react({ compiler: true })`, so tests exercise auto-memoized components like production does

> The Vitest setup uses the **native** (Rust) React Compiler from `oxc-transform-react`, an experimental optional peer of `@vitejs/plugin-react`. Next.js runs the same native compiler inside Turbopack (`reactCompiler` + `experimental.turbopackRustReactCompiler` in `next.config.ts`), so `babel-plugin-react-compiler` is not needed. The two are still configured independently.

### Best Practices

- **Type-safe mocks:** Use `vi.mock(import("module"), ...)`, never string-based
- **Accessing mocks:** Import mocked functions at the top level like any other import — `vi.mock` is hoisted before imports, so they resolve to the mock automatically. Never use `await import()` to access mocked values.
- **Async components with `use()`:** Wrap render in `await act(async () => render(...))`
- **Shared mocks:** Check `mocks/` before hand-rolling a stub. It holds stand-ins for the platform (Turso, MSW, Next, browser APIs happy-dom lacks) and fixtures of types several modules share; a helper that drives one module's internals belongs in that module's test, and its consumers mock the module. For `cookies()` from `next/headers`, use `mockCookieJar(cookie?)` from `@/mocks/headers`: it serves a `MockCookies` — a real jar over `@edge-runtime/cookies` that needs no casting to satisfy the return type, and lets tests assert on the resulting `set-cookie` header rather than on a `vi.fn` spy. See `app/lib/session.test.ts` and `app/lib/chatTip.test.ts`.
- **Lifecycle is global:** the config resets every mock to its factory implementation, restores spies and unstubs envs and globals before each test, and `vitest.setup.ts` mocks `server-only`, clears `getGlobal` state and turns off react-spring animations before each test and restores real timers and clears `<html>`'s attributes, `<head>`, cookies and localStorage after it. Don't repeat these in a file, and set mock defaults in the `vi.mock` factory or a `beforeEach`, since one set at file scope is gone by the second test. Undo any other state (DOM selection) in `afterEach`, never on a test's last line.
- **Hoist repeated setup:** setup written three times becomes a file-level hook or a local helper, or a shared one in `mocks/`.
- **Assert outside MSW handlers:** an `expect` inside a resolver fails as a 500 that hides the diff, and passes if the handler never matches. Record the request and assert after the call.
- **One test per branch:** add a test or an `it.each` row only when it takes a different path, not for a new input on the same one or for what another test's query already proves. Assert the specific error or arguments, so the test fails when its behaviour breaks.
- **Integration tests test the integration:** a page, action or component that composes others asserts the wiring and the composed outcome. The collaborator's branches, edge cases and exact output belong in its own unit test; don't copy its tables or wording.

## TypeScript

Strict mode enabled with `noUncheckedIndexedAccess` and `noPropertyAccessFromIndexSignature`. Always use optional chaining when accessing arrays/objects.

## Non-Obvious Patterns

### Zod v4 API

- **`.decode()` vs `.parse()`**: Use `.parse()` for untyped data, `.decode()` for typed inputs (compile-time checking)
- **`z.templateLiteral()`**: Precise string format validation (e.g., HSL colors)
- **`z.stringbool()`**: Env-style boolean coercion ("true"/"false"/"1"/"0")
- **`z.toJSONSchema()`**: Convert Zod schemas to JSON Schema (used for Anthropic tool input schemas)
- **`z.prettifyError()`**: Human-readable error formatting for `ZodError`
- **`z.coerce.date()`**: For parsing date strings, prefer `z.string().pipe(z.coerce.date())` over `.transform()` — validates the result instead of silently producing `Invalid Date`

### `useTransition` Naming Collision

`useTransition` is used from both `@react-spring/web` (animations in `ChatHistory`) and React (async transitions in `ChatInput`). Check imports carefully — they have different signatures and return types.

### Process-Wide Singletons

Next bundles `instrumentation.ts` and each route handler into separate module graphs, so a
module-level `let` is one instance per graph, not per process. State that must be shared
between them (the gateway connection, readiness) goes through `getGlobal` in
`app/lib/global.ts`; each test starts without it (`resetGlobals` in `vitest.setup.ts`), so don't reach for `vi.resetModules()`.

### Private Fields

Classes use JavaScript private fields (`#fieldName`), not TypeScript `private`. Use `#` for new private fields.

### Suspense for Date-Dependent Components

`useState(Date.now)` causes suspension during hydration (server/client time mismatch). Wrap components that use `Date` in `<Suspense>` — see `RelativeTime` usage in `RecentTracksList` and `ChatMessage`.

### setState During Render

Components use React's recommended [storing information from previous renders](https://react.dev/reference/react/useState#storing-information-from-previous-renders) pattern to adjust state based on changing props (e.g. `ChatToast`, `CaretBuddy`, `RelativeTime`). This is NOT an anti-pattern — do not suggest `useEffect` or `useMemo` as replacements.

### Style Variants

The site has three looks (panes, ledger, manual) over one markup. `app/global.css` is a
`:root` block of the custom properties the variants share, one `:root[data-variant="…"]`
block per variant setting the rest (`app/global.test.ts` checks each sets them all), then
rules that read only those properties: no rule outside the blocks names a variant. A change
that needs a variant to differ is a new property, not a scoped selector. Every variant shows
the same content; a variant may add decoration (glyphs, prefixes) but never words or controls
the others lack.

Visitors pick a variant and a theme (`system`, `light`, `dark`) in the footer. Each is a
`data-*` attribute on `<html>` and a cookie of the same name (`app/lib/preferences.ts`);
the server renders the fallbacks and a script in `<head>` applies the cookies before first
paint. Don't read them with `cookies()` in the layout: every page would render per request
and lose its static shell. Check chat changes in all three variants.

`theme-color` follows both from `grounds` in `app/lib/preferences.ts`, each variant's
`--ground` (a test keeps it in step with the CSS): the head script adds tags ahead of the
rendered fallbacks, and `PreferenceSwitch` retints them.

### Markdown Rendering

Discord message content is raw markdown, rendered by `app/components/chat/ChatMarkdown.tsx` from TanStack Markdown's `parseInline()`, so block syntax stays text. It is CommonMark, so small inline parsers add what Discord reads differently. Discord itself is the reference, not simple-markdown: it has diverged.

Two rules the tests pin: a link renders as typed unless it targets `http(s)`, `mailto` or `tel` (as Discord does; our autolinks only make `http(s)` and `mailto`), and `image` renders as alt text — never an `<img>`, since message authors choose the URL.

## Maintaining This Document

When making changes that affect documented patterns, architecture, commands, or conventions, update this file accordingly. Examples:

- Adding/removing environment variables → update the Environment Variables table
- Changing directory structure → update Directory Structure
- Adding new patterns or conventions → document them
- Modifying existing documented code → verify documentation still matches

**Keep it short.** This file is loaded into context for every session, every task, every
agent — every line here is paid for on every run. Document only what an agent cannot
readily infer from the codebase: commands, conventions, and the non-obvious decisions
behind them. Leave out anything the code, types, or tests already say. When adding a
section, look for one that has since become obsolete and remove it.
