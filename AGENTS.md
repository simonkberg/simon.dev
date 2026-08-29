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
- `pnpm lint` - Run TypeScript, ESLint, and Prettier checks
- `pnpm lint:fix` - Auto-fix ESLint and Prettier issues
- `pnpm test` - Run tests (auto-detects TTY; no `CI=true` prefix needed)
- `pnpm test --coverage` - Run tests with coverage report

> **Prefer `pnpm lint` and `pnpm lint:fix`** over individual commands (`lint:tsc`, `lint:eslint`, `lint:prettier`). They run all checks in parallel and complete in seconds.

### MCP Tools

MCP servers are configured in `.mcp.json`:

- `eslint` — ESLint MCP tools for targeted file linting when needed
- `next-devtools` — Next.js MCP tools (`nextjs_docs` for docs lookup, `nextjs_call` for app state)

### Docker

- Build: `docker build -t simon.dev .`
- Run: `docker run -p 3000:3000 simon.dev`
- Force clean build: `docker build --no-cache -t simon.dev .`

BuildKit cache mounts are used for pnpm store and Next.js build cache. Build args are used for secrets since Railway doesn't support secret mounts.

## Directory Structure

```
app/                          # Next.js App Router (all source code)
├── actions/                  # Server actions (chat, WakaTime, Last.fm)
├── api/chat/sse/             # SSE endpoint for real-time chat updates
├── assets/                   # Static assets (fonts, images)
├── components/               # Shared React components (with co-located tests)
├── config.ts                 # Site metadata, links, external usernames
├── health/                   # Health check endpoint for monitoring
├── lib/                      # Utility libraries and core logic
│   └── discord/              # Discord API, Gateway, bot, and shared schemas
├── listening/[[...period]]/  # Listening stats page (optional catch-all)
│   └── components/           # Route-specific components
├── layout.tsx                # Root layout
├── page.tsx                  # Home page
├── global-error.tsx          # Global error boundary
└── global-not-found.tsx      # Global 404 page

instrumentation.ts            # Server startup hooks (bot subscription)
mocks/                        # Test mocks (MSW handlers, env vars, cookies)
```

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
- `experimental: { useTypeScriptCli: false }` — type check through the TS 6 compiler API (see [TypeScript 7 and 6 side by side](#typescript-7-and-6-side-by-side))

> **Do not enable `partialPrefetching`.** It breaks `/listening/[[...period]]`: on a client
> navigation the URL updates but the statistics stay on the period first loaded. All six
> period links share one route, so they share one App Shell and the params-dependent content
> never re-resolves. Only reproduces in the deployed image, not a local production build.
> See #1997.

### Typed Routes

For optional catch-all routes like `[[...param]]`, use a trailing slash to link to the base path (e.g., `/listening/` not `/listening`).

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

Set `SKIP_ENV_VALIDATION=true` to skip validation (used in CI/Docker).

## Architecture

### Discord Integration

- **REST API** (`app/lib/discord/api.ts`): Discord API v10 for reading/posting messages
- **Gateway** (`app/lib/discord/gateway.ts`): WebSocket for real-time notifications with auto-reconnect and heartbeat
- **SSE** (`app/api/chat/sse/route.ts`): Streams chat updates to clients
- DataLoader with LRU cache (100 entries) batches user info requests
- Rate limit "gate" system prevents retry storms when Discord returns 429s
- Messages from site use "username: content" prefix format for attribution

### WakaTime Integration

- `app/lib/wakaTime.ts`: Fetches coding stats from public share URL (no API key)
- 3-second timeout, period filtering (`last_7_days`, `last_30_days`, `last_year`, `all_time`)

### Last.fm Integration

- `app/lib/lastfm.ts`: Wraps Last.fm Web Services API
- Methods: `user.getRecentTracks`, `user.getTopTracks`, `user.getTopArtists`, `user.getTopAlbums`
- 10-second timeout, period filtering (`7day`, `1month`, `3month`, `6month`, `12month`, `overall`)

### Anthropic Integration (simon-bot)

- `app/lib/anthropic.ts`: Claude Haiku 4.5 via raw `fetch` (no SDK) — async generator yielding text with tool use loop (chat history, message search, WakaTime, Last.fm)
- `app/lib/discord/bot.ts`: Bot logic — triggered by "simon-bot" mention (regex: `/\bsimon[- ]?bot\b/i`)
- Started at server boot via `instrumentation.ts` → `startBotSubscription()` (long-lived Gateway WebSocket subscription, not per-request)
- 5-second timeout per API call, Redis-based message deduplication (60s TTL) across instances
- Responses posted as threaded Discord replies

## Patterns

### Server Actions

All in `app/actions/`, marked with `"use server"`. Return discriminated unions:

```typescript
type Result = { status: "ok"; data: T } | { status: "error"; error: string };
```

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

Components accept `Promise<T>` props and unwrap with `use()`. Always wrap in `<Suspense>`:

```tsx
<Suspense fallback={<Loader />}>
    <DataTable data={fetchData()} />
</Suspense>;

// Component
const DataTable = ({ data }: { data: Promise<Data> }) => {
    const result = use(data);
    return <table>...</table>;
};
```

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

### TypeScript 7 and 6 side by side

TS 7 (native) ships a `tsc` CLI but no JS compiler API until 7.1, and typescript-eslint refuses to load without one. So `package.json` aliases both: `typescript` → `@typescript/typescript6` (what tools import), `@typescript/native` → `typescript@7` (the `tsc` behind `pnpm lint`). Neither is a mistake — don't "fix" them. The shim declares no `tsc` bin, so `experimental.useTypeScriptCli: false` is required; without it `next build` and `next typegen` fail to resolve one. Collapse both entries back into a plain `typescript` once 7.1 ships the API.

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
