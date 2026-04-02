# Discord Message Search for simon-bot

## Goal

Give simon-bot the ability to search Discord messages by text content, enabling queries like "what did X say about Y" or "what was X's first message". Scoped to the configured channel.

## Discord API

**Endpoint:** `GET /guilds/{guild.id}/messages/search`

Key query parameters we use:

| Parameter    | Type    | Description                             |
| ------------ | ------- | --------------------------------------- |
| `content`    | string  | Free-text search query (max 1024 chars) |
| `channel_id` | string  | Filter to specific channel              |
| `limit`      | integer | Max results, 1-25, default 25           |
| `sort_by`    | string  | `"timestamp"` or `"relevance"`          |
| `sort_order` | string  | `"asc"` or `"desc"` (default `"desc"`)  |

**Response shape:**

```json
{
  "total_results": 47,
  "messages": [
    [{ "matched message" }, { "context message" }, ...],
    ...
  ]
}
```

Each inner array contains the matched message (flagged with `hit: true` by Discord) plus surrounding context messages. We ignore `threads`, `members`, and `doing_deep_historical_index` fields.

Requires `READ_MESSAGE_HISTORY` permission (the bot already has this). May return HTTP 202 if indexing is incomplete — we let the existing error handling surface this.

## Changes

### 1. `app/lib/discord/schemas.ts`

Add `timestamp` as a required field to `DiscordMessageSchema`:

```typescript
timestamp: z.string(),
```

Discord always returns this field. Making it required is the correct type. Existing consumers are unaffected since the data was always present — we just weren't parsing it.

### 2. `app/lib/discord/api.ts`

New response schema for the search endpoint. Discord marks the matched message in each inner array with `hit: true` — we extend `DiscordMessageSchema` to capture this:

```typescript
const SearchMessageSchema = DiscordMessageSchema.extend({
    hit: z.boolean().optional(),
});

const SearchGuildMessagesResponseSchema = z.object({
    total_results: z.number(),
    messages: z.array(z.array(SearchMessageSchema)),
});
```

New exported type for search results:

```typescript
type SearchMessage = {
    id: string;
    username: string;
    content: string;
    timestamp: string;
};

type SearchHit = { hit: SearchMessage; context: SearchMessage[] };

type SearchResult = { total_results: number; hits: SearchHit[] };
```

New exported function:

```typescript
async function searchChannelMessages(params: {
    content: string;
    limit?: number;
    sort_by?: "timestamp" | "relevance";
    sort_order?: "asc" | "desc";
}): Promise<SearchResult>;
```

Implementation:

- Calls `call("GET", "guilds/{guild_id}/messages/search", schema, { channel_id, ...params })`
- Passes `channel_id` as a single value in the query string (the API documents it as an array of snowflakes, but a single value works for our single-channel use case)
- Maps each inner message array to a `SearchHit`:
    - Identifies the hit message via the `hit: true` boolean flag Discord sets on the matched message
    - Resolves usernames via `parseUsernamePrefix` with `userLoader` fallback (same pattern as `getMessageChain`)
    - Keeps content as plain text (no HTML parsing — this data goes to the bot, not the UI)
    - Includes `timestamp` from the Discord message object

### 3. `app/lib/anthropic.ts`

New Zod input schema:

```typescript
const searchMessagesInputSchema = z.object({
    content: z.string().describe("Search query text"),
    limit: z.number().min(1).max(25).default(25).describe("Max results"),
    sort_by: z
        .enum(["timestamp", "relevance"])
        .default("relevance")
        .describe("Sort by timestamp or relevance"),
    sort_order: z
        .enum(["asc", "desc"])
        .default("desc")
        .describe("Sort direction"),
});
```

New entry in `TOOLS` array:

```typescript
{
  name: "search_messages",
  description: "Search chat messages by text content. Use to find messages from a specific user (search their username), look up past conversations about a topic, or find someone's first/latest messages. Returns matched messages with surrounding context.",
  input_schema: z.toJSONSchema(searchMessagesInputSchema),
}
```

New case in `executeTool`:

```typescript
case "search_messages": {
  const params = searchMessagesInputSchema.parse(input);
  return JSON.stringify(await searchChannelMessages(params));
}
```

Update system prompt tool list mention to include message search.

### 4. Testing

**MSW handler:** New handler matching `GET */guilds/:guildId/messages/search` returning the nested array response format.

**`api.ts` tests:**

- Happy path: search returns hits with context, username resolution works (prefix-based and userLoader fallback), timestamps present
- Empty results: `total_results: 0, messages: []` returns `{ total_results: 0, hits: [] }`
- Query params passed correctly to Discord API

**`anthropic.ts` tests:**

- `search_messages` tool execution calls `searchChannelMessages` with parsed params and returns stringified result

## What this does NOT include

- Pagination (offset-based) — the bot gets up to 25 results per call, with `total_results` indicating if there are more
- Thread-aware result handling — context messages are included flat, no thread tree construction
- UI integration — this is bot-only, no frontend changes
- Any other search filters (author_id, has, pinned, etc.) — scoped to free-text content search only
