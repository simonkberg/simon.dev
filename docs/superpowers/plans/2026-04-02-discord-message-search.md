# Discord Message Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give simon-bot a `search_messages` tool that searches Discord messages by text content via the Search Guild Messages API.

**Architecture:** Add `searchChannelMessages` to the existing Discord API layer (`api.ts`), wire it as a new Anthropic tool in `anthropic.ts`. The search function reuses existing username resolution patterns and the `call()` helper for rate-limited Discord API access.

**Tech Stack:** Next.js, Zod, MSW (testing), Vitest

**Spec:** `docs/superpowers/specs/2026-04-02-discord-message-search-design.md`

---

### Task 1: Add `timestamp` to `DiscordMessageSchema`

**Files:**

- Modify: `app/lib/discord/schemas.ts`
- Modify: `app/lib/discord/api.test.ts`

- [ ] **Step 1: Add `timestamp` field to the schema**

In `app/lib/discord/schemas.ts`, add `timestamp` as a required string field:

```typescript
export const DiscordMessageSchema = z.object({
    type: z.number(),
    id: z.string(),
    channel_id: z.string().optional(),
    author: z.object({ id: z.string() }),
    content: z.string(),
    timestamp: z.string(),
    edited_timestamp: z.string().nullable().optional(),
    message_reference: z
        .object({ message_id: z.string().optional() })
        .optional(),
});
```

- [ ] **Step 2: Run tests to see what breaks**

Run: `pnpm test app/lib/discord/api.test.ts`

Expected: Multiple failures — all mock Discord messages lack `timestamp`, causing Zod parse errors.

- [ ] **Step 3: Add `timestamp` to all mock Discord messages in `api.test.ts`**

Add `timestamp: "2025-01-01T00:00:00.000000+00:00"` to every mock Discord message object in the test file. These appear in `HttpResponse.json(...)` calls inside MSW handlers. Every object with `type`, `id`, `author`, `content` needs the field added.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test app/lib/discord/api.test.ts`

Expected: All existing tests pass.

- [ ] **Step 5: Run full test suite to check for other breakage**

Run: `pnpm test`

Expected: All tests pass. If any other test files construct `DiscordMessage` objects or mock Discord API responses, add `timestamp` there too.

- [ ] **Step 6: Commit**

```bash
git add app/lib/discord/schemas.ts app/lib/discord/api.test.ts
git commit -m "feat: add timestamp to DiscordMessageSchema"
```

---

### Task 2: Add `searchChannelMessages` to Discord API layer (TDD)

**Files:**

- Modify: `app/lib/discord/api.ts`
- Modify: `app/lib/discord/api.test.ts`

- [ ] **Step 1: Write the failing test — happy path with username prefix**

Add to `app/lib/discord/api.test.ts`. Import `searchChannelMessages` alongside existing imports:

```typescript
import {
    _resetRateLimitState,
    _setRateLimitGate,
    getChannelMessages,
    getMessageChain,
    postChannelMessage,
    searchChannelMessages,
} from "./api";
```

Add a new `describe` block:

```typescript
describe("searchChannelMessages", () => {
    it("should search messages and return hits with context", async () => {
        server.use(
            http.get(
                `${DISCORD_BASE_URL}/guilds/:guildId/messages/search`,
                ({ request }) => {
                    const url = new URL(request.url);
                    expect(url.searchParams.get("content")).toBe("hello");
                    expect(url.searchParams.get("channel_id")).toBe(
                        "test-discord-channel-id",
                    );
                    expect(url.searchParams.get("limit")).toBe("5");
                    expect(url.searchParams.get("sort_by")).toBe("relevance");
                    expect(url.searchParams.get("sort_order")).toBe("desc");

                    return HttpResponse.json({
                        total_results: 1,
                        messages: [
                            [
                                {
                                    type: 0,
                                    id: "ctx-1",
                                    author: { id: "user1" },
                                    content: "Alice: before the match",
                                    timestamp:
                                        "2025-01-01T00:00:00.000000+00:00",
                                    edited_timestamp: null,
                                },
                                {
                                    type: 0,
                                    id: "hit-1",
                                    author: { id: "user2" },
                                    content: "Bob: hello everyone",
                                    timestamp:
                                        "2025-01-01T00:01:00.000000+00:00",
                                    edited_timestamp: null,
                                    hit: true,
                                },
                                {
                                    type: 0,
                                    id: "ctx-2",
                                    author: { id: "user3" },
                                    content: "Charlie: after the match",
                                    timestamp:
                                        "2025-01-01T00:02:00.000000+00:00",
                                    edited_timestamp: null,
                                },
                            ],
                        ],
                    });
                },
            ),
        );

        const result = await searchChannelMessages({
            content: "hello",
            limit: 5,
            sort_by: "relevance",
            sort_order: "desc",
        });

        expect(result).toEqual({
            total_results: 1,
            hits: [
                {
                    hit: {
                        id: "hit-1",
                        username: "Bob",
                        content: "hello everyone",
                        timestamp: "2025-01-01T00:01:00.000000+00:00",
                    },
                    context: [
                        {
                            id: "ctx-1",
                            username: "Alice",
                            content: "before the match",
                            timestamp: "2025-01-01T00:00:00.000000+00:00",
                        },
                        {
                            id: "ctx-2",
                            username: "Charlie",
                            content: "after the match",
                            timestamp: "2025-01-01T00:02:00.000000+00:00",
                        },
                    ],
                },
            ],
        });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test app/lib/discord/api.test.ts -t "should search messages"`

Expected: FAIL — `searchChannelMessages` is not exported from `./api`.

- [ ] **Step 3: Implement `searchChannelMessages`**

Add to `app/lib/discord/api.ts`:

```typescript
const SearchMessageSchema = DiscordMessageSchema.extend({
    hit: z.boolean().optional(),
});

const SearchGuildMessagesResponseSchema = z.object({
    total_results: z.number(),
    messages: z.array(z.array(SearchMessageSchema)),
});

export type SearchMessage = {
    id: string;
    username: string;
    content: string;
    timestamp: string;
};

export type SearchHit = { hit: SearchMessage; context: SearchMessage[] };

export type SearchResult = { total_results: number; hits: SearchHit[] };

async function resolveSearchMessage(
    msg: z.infer<typeof SearchMessageSchema>,
): Promise<SearchMessage> {
    const parsed = parseUsernamePrefix(msg.content);
    const username = parsed
        ? parsed[0]
        : (await userLoader.load(msg.author.id)).name;
    const content = (parsed?.[1] ?? msg.content).trim();
    return { id: msg.id, username, content, timestamp: msg.timestamp };
}

export async function searchChannelMessages(params: {
    content: string;
    limit?: number;
    sort_by?: "timestamp" | "relevance";
    sort_order?: "asc" | "desc";
}): Promise<SearchResult> {
    const response = await call(
        "GET",
        `guilds/${env.DISCORD_GUILD_ID}/messages/search`,
        SearchGuildMessagesResponseSchema,
        { channel_id: env.DISCORD_CHANNEL_ID, ...params },
    );

    const hits = await Promise.all(
        response.messages.map(async (group) => {
            const hitMsg = group.find((msg) => msg.hit === true);
            if (!hitMsg) return null;

            const contextMsgs = group.filter((msg) => msg !== hitMsg);

            const [hit, ...context] = await Promise.all([
                resolveSearchMessage(hitMsg),
                ...contextMsgs.map(resolveSearchMessage),
            ]);

            return { hit, context };
        }),
    );

    return {
        total_results: response.total_results,
        hits: hits.filter((h) => h !== null),
    };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test app/lib/discord/api.test.ts -t "should search messages"`

Expected: PASS

- [ ] **Step 5: Write test — empty results**

Add to the `searchChannelMessages` describe block:

```typescript
it("should handle empty search results", async () => {
    server.use(
        http.get(`${DISCORD_BASE_URL}/guilds/:guildId/messages/search`, () =>
            HttpResponse.json({ total_results: 0, messages: [] }),
        ),
    );

    const result = await searchChannelMessages({ content: "nonexistent" });

    expect(result).toEqual({ total_results: 0, hits: [] });
});
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm test app/lib/discord/api.test.ts -t "should handle empty search"`

Expected: PASS (already handled by the implementation).

- [ ] **Step 7: Write test — username resolution via guild member API**

Add to the `searchChannelMessages` describe block:

```typescript
it("should resolve username via guild member API when no prefix", async () => {
    server.use(
        http.get(`${DISCORD_BASE_URL}/guilds/:guildId/messages/search`, () =>
            HttpResponse.json({
                total_results: 1,
                messages: [
                    [
                        {
                            type: 0,
                            id: "search-noprefix-1",
                            author: { id: "user-lookup-1" },
                            content: "unprefixed message",
                            timestamp: "2025-06-01T12:00:00.000000+00:00",
                            edited_timestamp: null,
                            hit: true,
                        },
                    ],
                ],
            }),
        ),
        http.get(
            `${DISCORD_BASE_URL}/guilds/:guildId/members/:userId`,
            ({ params }) => {
                expect(params["userId"]).toBe("user-lookup-1");
                return HttpResponse.json({
                    user: {
                        username: "discorduser",
                        global_name: "Discord User",
                    },
                    nick: "Nickname",
                });
            },
        ),
    );

    const result = await searchChannelMessages({ content: "unprefixed" });

    expect(result.hits[0]?.hit).toMatchObject({
        username: "Nickname",
        content: "unprefixed message",
    });
});
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm test app/lib/discord/api.test.ts -t "should resolve username via guild"`

Expected: PASS

- [ ] **Step 9: Write test — default parameters**

Add to the `searchChannelMessages` describe block:

```typescript
it("should pass only provided params to Discord API", async () => {
    server.use(
        http.get(
            `${DISCORD_BASE_URL}/guilds/:guildId/messages/search`,
            ({ request }) => {
                const url = new URL(request.url);
                expect(url.searchParams.get("content")).toBe("test");
                expect(url.searchParams.get("channel_id")).toBe(
                    "test-discord-channel-id",
                );
                expect(url.searchParams.has("limit")).toBe(false);
                expect(url.searchParams.has("sort_by")).toBe(false);
                expect(url.searchParams.has("sort_order")).toBe(false);

                return HttpResponse.json({ total_results: 0, messages: [] });
            },
        ),
    );

    await searchChannelMessages({ content: "test" });
});
```

- [ ] **Step 10: Run test to verify it passes**

Run: `pnpm test app/lib/discord/api.test.ts -t "should pass only provided params"`

Expected: PASS. The `call()` helper iterates `Object.entries(params)` — `undefined` values from omitted optional params won't be set since the spread of `params` only includes `content` (the only key passed). If this fails because `undefined` values are being stringified, filter them out in `searchChannelMessages` before passing to `call()`:

```typescript
const queryParams: Record<string, unknown> = {
    channel_id: env.DISCORD_CHANNEL_ID,
    content: params.content,
};
if (params.limit != null) queryParams["limit"] = params.limit;
if (params.sort_by != null) queryParams["sort_by"] = params.sort_by;
if (params.sort_order != null) queryParams["sort_order"] = params.sort_order;
```

- [ ] **Step 11: Run full api.test.ts suite**

Run: `pnpm test app/lib/discord/api.test.ts`

Expected: All tests pass.

- [ ] **Step 12: Commit**

```bash
git add app/lib/discord/api.ts app/lib/discord/api.test.ts
git commit -m "feat: add searchChannelMessages to Discord API layer"
```

---

### Task 3: Add `search_messages` tool to Anthropic integration (TDD)

**Files:**

- Modify: `app/lib/anthropic.ts`
- Modify: `app/lib/anthropic.test.ts`

- [ ] **Step 1: Update the mock for `@/lib/discord/api` in the test file**

In `app/lib/anthropic.test.ts`, add `searchChannelMessages` to the mock and import:

```typescript
import { getChannelMessages, searchChannelMessages } from "@/lib/discord/api";

vi.mock(import("@/lib/discord/api"), () => ({
    getChannelMessages: vi.fn(),
    searchChannelMessages: vi.fn(),
}));
```

- [ ] **Step 2: Write the failing test for search_messages tool**

Add inside the `describe("tool execution", ...)` block in `app/lib/anthropic.test.ts`:

```typescript
it("should call searchChannelMessages for search_messages tool", async () => {
    const mockSearchResult = {
        total_results: 1,
        hits: [
            {
                hit: {
                    id: "1",
                    username: "Alice",
                    content: "hello world",
                    timestamp: "2025-01-01T00:00:00.000000+00:00",
                },
                context: [],
            },
        ],
    };
    vi.mocked(searchChannelMessages).mockResolvedValue(mockSearchResult);

    let callCount = 0;

    server.use(
        http.post(ANTHROPIC_BASE_URL, async ({ request }) => {
            callCount++;

            const toolUse = {
                type: "tool_use",
                id: "tool_1",
                name: "search_messages",
                input: {
                    content: "hello",
                    limit: 10,
                    sort_by: "timestamp",
                    sort_order: "asc",
                },
            };

            if (callCount === 1) {
                return HttpResponse.json({
                    content: [toolUse],
                    stop_reason: "tool_use",
                });
            }

            expect(await request.json()).toMatchObject({
                messages: [
                    { role: "user", content: `${TEST_USERNAME}: Test` },
                    { role: "assistant", content: [toolUse] },
                    {
                        role: "user",
                        content: [
                            {
                                type: "tool_result",
                                tool_use_id: toolUse.id,
                                content: JSON.stringify(mockSearchResult),
                            },
                        ],
                    },
                ],
            });

            return HttpResponse.json({
                content: [{ type: "text", text: "found it" }],
                stop_reason: "end_turn",
            });
        }),
    );

    await collectResponses(
        createMessage([
            { role: "user", username: TEST_USERNAME, content: "Test" },
        ]),
    );

    expect(searchChannelMessages).toHaveBeenCalledWith({
        content: "hello",
        limit: 10,
        sort_by: "timestamp",
        sort_order: "asc",
    });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test app/lib/anthropic.test.ts -t "should call searchChannelMessages"`

Expected: FAIL — `search_messages` tool not recognized, returns `{ error: "Unknown tool: search_messages" }`.

- [ ] **Step 4: Add the search tool to `anthropic.ts`**

In `app/lib/anthropic.ts`:

1. Add import for `searchChannelMessages`:

```typescript
import { getChannelMessages, searchChannelMessages } from "@/lib/discord/api";
```

2. Add the input schema after the existing schemas:

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

3. Add the tool definition to the `TOOLS` array:

```typescript
  {
    name: "search_messages",
    description:
      "Search chat messages by text content. Use to find messages from a specific user (search their username), look up past conversations about a topic, or find someone's first/latest messages. Returns matched messages with surrounding context.",
    input_schema: z.toJSONSchema(searchMessagesInputSchema),
  },
```

4. Add the case in `executeTool`:

```typescript
      case "search_messages": {
        const params = searchMessagesInputSchema.parse(input);
        return JSON.stringify(await searchChannelMessages(params));
      }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test app/lib/anthropic.test.ts -t "should call searchChannelMessages"`

Expected: PASS

- [ ] **Step 6: Update the tools list assertion in the existing test**

The test `"should create message and yield text content"` asserts the exact tools list. Add `{ name: "search_messages" }` to the expected `tools` array:

```typescript
          tools: [
            { name: "get_chat_history" },
            { name: "get_wakatime_stats" },
            { name: "get_recent_tracks" },
            { name: "get_top_tracks" },
            { name: "get_top_artists" },
            { name: "get_top_albums" },
            { name: "search_messages" },
          ],
```

- [ ] **Step 7: Update the system prompt**

In `app/lib/anthropic.ts`, update the system prompt's tool description line from:

```
You have tools to look up chat history, Simon's coding stats, and music
listening history. Use them when relevant.
```

to:

```
You have tools to look up chat history, search past messages, check Simon's
coding stats, and browse music listening history. Use them when relevant.
```

- [ ] **Step 8: Run full anthropic.test.ts suite**

Run: `pnpm test app/lib/anthropic.test.ts`

Expected: All tests pass.

- [ ] **Step 9: Run full test suite**

Run: `pnpm test`

Expected: All tests pass.

- [ ] **Step 10: Run linter**

Run: `pnpm lint`

Expected: No errors.

- [ ] **Step 11: Commit**

```bash
git add app/lib/anthropic.ts app/lib/anthropic.test.ts
git commit -m "feat: add search_messages tool to simon-bot"
```
