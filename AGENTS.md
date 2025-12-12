# AGENTS.md

This file provides guidance to AI coding agents when working with code in this repository.

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

### MCP Tools

MCP servers are configured in `.mcp.json`:

- Use ESLint MCP tools for linting instead of `pnpm lint` directly
- Consult Next.js documentation via the `nextjs_docs` MCP tool for Next.js questions

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
├── health/                   # Health check endpoint for monitoring
├── lib/                      # Utility libraries and core logic
│   └── discord/              # Discord API and Gateway integration
├── listening/[[...period]]/  # Listening stats page (optional catch-all)
│   └── components/           # Route-specific components
├── layout.tsx                # Root layout
├── page.tsx                  # Home page
├── global-error.tsx          # Global error boundary
└── global-not-found.tsx      # Global 404 page

mocks/                        # Test mocks (MSW handlers, env vars)
```

**Convention:** Route-specific components live in `{route}/components/` rather than `app/components/`.

## Configuration

### Path Aliases

- `@/*` → `app/*`
- `@/mocks/*` → `mocks/*`

### Typed Routes

`typedRoutes` is enabled for type-safe `<Link>` hrefs. For optional catch-all routes like `[[...param]]`, use a trailing slash to link to the base path (e.g., `/listening/` not `/listening`).

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
- Messages from site use "username: content" prefix format for attribution

### WakaTime Integration

- `app/lib/wakaTime.ts`: Fetches coding stats from public share URL (no API key)
- 3-second timeout, period filtering (`last_7_days`, `last_30_days`, `last_year`, `all_time`)

### Last.fm Integration

- `app/lib/lastfm.ts`: Wraps Last.fm Web Services API
- Methods: `user.getRecentTracks`, `user.getTopTracks`, `user.getTopArtists`, `user.getTopAlbums`
- 3-second timeout, period filtering (`7day`, `1month`, `3month`, `6month`, `12month`, `overall`)

### Anthropic Integration (simon-bot)

- `app/lib/anthropic.ts`: Claude Haiku 4.5 for chat responses
- Triggered by "simon-bot" mention (case-insensitive, word boundary: `/\bsimon[- ]?bot\b/i`)
- 5-second timeout, runs async via Next.js `after()` to avoid blocking
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

Files that must not run on client import `"server-only"` at top (e.g., `discord/api.ts`, `discord/gateway.ts`, `session.ts`).

## Testing

- **Environment:** happy-dom
- **Location:** Co-located with source files (`*.test.ts`, `*.test.tsx`)
- **Mocking:** MSW in `mocks/node.ts`, env vars in `mocks/env.ts`

### Best Practices

- **Type-safe mocks:** Use `vi.mock(import("module"), ...)`, never string-based
- **Async components with `use()`:** Wrap render in `await act(async () => render(...))`
- **Server-only modules:** Mock with `vi.mock("server-only", () => ({}))`

## TypeScript

Strict mode enabled with `noUncheckedIndexedAccess` and `noPropertyAccessFromIndexSignature`. Always use optional chaining when accessing arrays/objects.

## Non-Obvious Patterns

### Zod v4 API

- **`.decode()` vs `.parse()`**: Use `.parse()` for untyped data, `.decode()` for typed inputs (compile-time checking)
- **`z.templateLiteral()`**: Precise string format validation (e.g., HSL colors)
- **`z.stringbool()`**: Env-style boolean coercion ("true"/"false"/"1"/"0")

### `useTransition` Naming Collision

`useTransition` in this codebase is from `@react-spring/web` for animations, NOT React's async transition hook. Check imports carefully.

### Private Fields

Classes use JavaScript private fields (`#fieldName`), not TypeScript `private`. Use `#` for new private fields.
