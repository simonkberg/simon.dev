<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

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

### MCP Tools

MCP servers are configured in `.mcp.json`:

- `next-devtools` — Next.js MCP tools (`nextjs_docs` for docs lookup, `nextjs_call` for app state)

### Docker

- Build: `docker build -t simon.dev .`
- Run: `docker run -p 3000:3000 simon.dev`
- Force clean build: `docker build --no-cache -t simon.dev .`

BuildKit cache mounts are used for pnpm store and Next.js build cache. Build args are used for secrets since Railway doesn't support secret mounts.

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
- `experimental: { globalNotFound: true }` — top-level 404 page
- `experimental: { turbopackRustReactCompiler: true }` — native (Rust) React Compiler inside Turbopack

> **Do not enable `partialPrefetching`.** It breaks `/listening/[[...period]]`: on a client
> navigation the URL updates but the statistics stay on the period first loaded. All six
> period links share one route, so they share one App Shell and the params-dependent content
> never re-resolves. Only reproduces in the deployed image, not a local production build.
> See #1997.

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

| Variable                   | Description                                                      |
| -------------------------- | ---------------------------------------------------------------- |
| `SESSION_SECRET`           | Session encryption (auto-defaults to "unsafe_dev_secret" in dev) |
| `DISCORD_BOT_TOKEN`        | Discord bot token                                                |
| `DISCORD_GUILD_ID`         | Discord guild ID                                                 |
| `DISCORD_CHANNEL_ID`       | Discord channel ID                                               |
| `UPSTASH_REDIS_REST_URL`   | Upstash Redis URL                                                |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis token                                              |
| `LAST_FM_API_KEY`          | Last.fm API key                                                  |
| `ANTHROPIC_API_KEY`        | Anthropic API key for simon-bot                                  |
| `TURSO_DATABASE_URL`       | Turso database URL, simon-bot's memory                           |
| `TURSO_AUTH_TOKEN`         | Turso auth token                                                 |

Set `SKIP_ENV_VALIDATION=true` to skip validation (used in CI/Docker).

## Architecture

Integrations live in `app/lib/` — Discord (REST + Gateway WebSocket, streamed to clients
from `app/api/chat/sse/`), WakaTime, Last.fm and Anthropic. The non-obvious parts:

- **Discord:** a DataLoader with a 100-entry LRU batches user lookups, and a rate-limit
  "gate" prevents retry storms when Discord returns 429s. Messages from the site carry a
  `username: content` prefix for attribution.
- **WakaTime:** reads a public share URL, so there is no API key. 3s timeout; Last.fm 10s.
- **simon-bot:** `app/lib/anthropic.ts` calls Claude Sonnet 5 (adaptive thinking, `medium` effort for replies,
  `high` for reflection) with raw `fetch`, no SDK; a "simon-bot" mention triggers it. It starts once at
  server boot from `instrumentation.ts` — one long-lived Gateway subscription, not
  per-request — and dedupes through Redis (60s TTL) so multiple instances don't
  double-reply.
- **simon-bot memory:** `app/lib/turso.ts` calls Turso's HTTP pipeline endpoint with raw
  `fetch`. `app/lib/migrations.ts` is an append-only list of idempotent statements applied
  at boot under a Redis lock. `app/lib/memory.ts` owns the `memories` table and renders the
  `<memory>` system-prompt block: `self`, `style`, `interests`, `context` and `people/<username>` for
  the current participants in full, every other category as a name and count the bot reads
  with `recall`. `edit` and `forget` are compare-and-swap on the note's text. Memory
  failures degrade to a reply without memory, never to no reply.
- **simon-bot self:** the bot's `self` and `style` notes are its personality and voice; the
  base prompt in `app/lib/anthropic.ts` carries a starting point they take precedence over.
  `app/lib/reflection.ts` runs after every reply, fire-and-forget, with only the memory
  tools, so bookkeeping never delays a response. Simon is recognised by his username:
  site visitors get generated names, so only his own Discord messages appear as "simon".

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
in `<Suspense>`.

### Page Metadata

- Root layout template: `%s - Simon Kjellberg`
- Subpages only set `title: "PageName"`
- `global-error.tsx` and `global-not-found.tsx` must set full titles manually (don't inherit template)

### Server-Only Code

Files that must not run on client import `"server-only"` at top (e.g., `app/lib/discord/api.ts`, `app/lib/discord/gateway.ts`, `app/lib/session.ts`).

## Testing

- **Environment:** happy-dom
- **Location:** Co-located with source files (`*.test.ts`, `*.test.tsx`)
- **Mocking:** MSW in `mocks/node.ts` (configured in `vitest.setup.ts`), env vars in `mocks/env.ts`, cookies in `mocks/headers.ts`
- **React Compiler:** enabled in `vitest.config.ts` via `react({ compiler: true })`, so tests exercise auto-memoized components like production does

> The Vitest setup uses the **native** (Rust) React Compiler from `oxc-transform-react`, an experimental optional peer of `@vitejs/plugin-react`. Next.js runs the same native compiler inside Turbopack (`reactCompiler` + `experimental.turbopackRustReactCompiler` in `next.config.ts`), so `babel-plugin-react-compiler` is not needed. The two are still configured independently.

### Best Practices

- **Type-safe mocks:** Use `vi.mock(import("module"), ...)`, never string-based
- **Accessing mocks:** Import mocked functions at the top level like any other import — `vi.mock` is hoisted before imports, so they resolve to the mock automatically. Never use `await import()` to access mocked values.
- **Async components with `use()`:** Wrap render in `await act(async () => render(...))`
- **Server-only modules:** Mock with `vi.mock("server-only", () => ({}))`
- **Shared mocks:** Check `mocks/` before hand-rolling a stub. For `cookies()` from `next/headers`, use `MockCookies` from `@/mocks/headers` — a real jar over `@edge-runtime/cookies` that needs no casting to satisfy the return type, and lets tests assert on the resulting `set-cookie` header rather than on a `vi.fn` spy. See `app/lib/session.test.ts` and `app/lib/chatTip.test.ts`.

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

### Private Fields

Classes use JavaScript private fields (`#fieldName`), not TypeScript `private`. Use `#` for new private fields.

### Suspense for Date-Dependent Components

`useState(Date.now)` causes suspension during hydration (server/client time mismatch). Wrap components that use `Date` in `<Suspense>` — see `RelativeTime` usage in `RecentTracksList` and `ChatMessage`.

### setState During Render

Components use React's recommended [storing information from previous renders](https://react.dev/reference/react/useState#storing-information-from-previous-renders) pattern to adjust state based on changing props (e.g. `ChatToast`, `CaretBuddy`, `RelativeTime`). This is NOT an anti-pattern — do not suggest `useEffect` or `useMemo` as replacements.

### Markdown Rendering

Discord message content is raw markdown, rendered by `app/components/Markdown.tsx`. We use simple-markdown's parser and walk the AST ourselves — their React output builds React 18 elements (`react.element` brand) that React 19 rejects, so don't swap in `defaultReactOutput`.

Two rules the tests pin: `sanitizeUrl()` guards every `link` target (a rejected one renders as plain text), and `image` renders as alt text — never an `<img>`, since message authors choose the URL.

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
