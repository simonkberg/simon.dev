import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { log } from "@/lib/log";
import type { Username } from "@/lib/session";
import { server } from "@/mocks/node";

import { getChannelMessages, postChannelMessage } from "./api";

vi.mock(import("server-only"), () => ({}));

const DISCORD_BASE_URL = "https://discord.com/api/v10";

describe("getChannelMessages", () => {
  it("should fetch and parse messages successfully", async () => {
    server.use(
      http.get(`${DISCORD_BASE_URL}/channels/:channelId/messages`, () =>
        HttpResponse.json([
          {
            type: 0,
            id: "1",
            author: { id: "user1" },
            content: "TestUser: Hello world",
            edited_timestamp: null,
          },
        ]),
      ),
    );

    const messages = await getChannelMessages();

    expect(messages).toMatchObject([
      {
        id: "1",
        content: "Hello world",
        edited: false,
        user: { name: "TestUser" },
      },
    ]);
  });

  it("should parse markdown to HTML in content", async () => {
    server.use(
      http.get(`${DISCORD_BASE_URL}/channels/:channelId/messages`, () =>
        HttpResponse.json([
          {
            type: 0,
            id: "1",
            author: { id: "user1" },
            content: "TestUser: **Bold** and *italic*",
            edited_timestamp: null,
          },
        ]),
      ),
    );

    const messages = await getChannelMessages();

    expect(messages).toMatchObject([
      { content: "<strong>Bold</strong> and <em>italic</em>" },
    ]);
  });

  it("should lookup user via guild member API when no prefix", async () => {
    server.use(
      http.get(`${DISCORD_BASE_URL}/channels/:channelId/messages`, () =>
        HttpResponse.json([
          {
            type: 0,
            id: "1",
            author: { id: "user123" },
            content: "No prefix here",
            edited_timestamp: null,
          },
        ]),
      ),
      http.get(
        `${DISCORD_BASE_URL}/guilds/:guildId/members/:userId`,
        ({ params }) => {
          expect(params["userId"]).toBe("user123");
          return HttpResponse.json({
            user: { username: "discorduser", global_name: "Discord User" },
            nick: "Server Nick",
          });
        },
      ),
    );

    const messages = await getChannelMessages();

    expect(messages).toMatchObject([
      { content: "No prefix here", user: { name: "Server Nick" } },
    ]);
  });

  it("should use global_name when nick is null", async () => {
    server.use(
      http.get(`${DISCORD_BASE_URL}/channels/:channelId/messages`, () =>
        HttpResponse.json([
          {
            type: 0,
            id: "1",
            author: { id: "user456" },
            content: "Message",
            edited_timestamp: null,
          },
        ]),
      ),
      http.get(`${DISCORD_BASE_URL}/guilds/:guildId/members/:userId`, () =>
        HttpResponse.json({
          user: { username: "discorduser", global_name: "Global Name" },
          nick: null,
        }),
      ),
    );

    const messages = await getChannelMessages();

    expect(messages).toMatchObject([{ user: { name: "Global Name" } }]);
  });

  it("should use username when nick and global_name are null", async () => {
    server.use(
      http.get(`${DISCORD_BASE_URL}/channels/:channelId/messages`, () =>
        HttpResponse.json([
          {
            type: 0,
            id: "1",
            author: { id: "user789" },
            content: "Message",
            edited_timestamp: null,
          },
        ]),
      ),
      http.get(`${DISCORD_BASE_URL}/guilds/:guildId/members/:userId`, () =>
        HttpResponse.json({
          user: { username: "fallbackuser", global_name: null },
          nick: null,
        }),
      ),
    );

    const messages = await getChannelMessages();

    expect(messages).toMatchObject([{ user: { name: "fallbackuser" } }]);
  });

  it("should handle edited messages", async () => {
    server.use(
      http.get(`${DISCORD_BASE_URL}/channels/:channelId/messages`, () =>
        HttpResponse.json([
          {
            type: 0,
            id: "1",
            author: { id: "user1" },
            content: "User: Edited message",
            edited_timestamp: "2024-01-01T00:00:00Z",
          },
        ]),
      ),
    );

    const messages = await getChannelMessages();

    expect(messages).toMatchObject([{ edited: true }]);
  });

  it("should handle replies as nested messages with multiple levels", async () => {
    server.use(
      http.get(`${DISCORD_BASE_URL}/channels/:channelId/messages`, () =>
        HttpResponse.json([
          {
            type: 0,
            id: "1",
            author: { id: "user1" },
            content: "User1: Parent message",
            edited_timestamp: null,
          },
          {
            type: 19,
            id: "2",
            author: { id: "user2" },
            content: "User2: First reply",
            edited_timestamp: null,
            message_reference: { message_id: "1" },
          },
          {
            type: 19,
            id: "3",
            author: { id: "user3" },
            content: "User3: Reply to reply",
            edited_timestamp: null,
            message_reference: { message_id: "2" },
          },
          {
            type: 19,
            id: "4",
            author: { id: "user4" },
            content: "User4: Another top-level reply",
            edited_timestamp: null,
            message_reference: { message_id: "1" },
          },
        ]),
      ),
    );

    const messages = await getChannelMessages();

    expect(messages).toMatchObject([
      {
        id: "1",
        content: "Parent message",
        replies: [
          {
            id: "2",
            content: "First reply",
            replies: [{ id: "3", content: "Reply to reply" }],
          },
          { id: "4", content: "Another top-level reply" },
        ],
      },
    ]);
  });

  it("should exclude replies that reference missing parent messages", async () => {
    server.use(
      http.get(`${DISCORD_BASE_URL}/channels/:channelId/messages`, () =>
        HttpResponse.json([
          {
            type: 0,
            id: "1",
            author: { id: "user1" },
            content: "User1: Message 1",
            edited_timestamp: null,
          },
          {
            type: 19,
            id: "2",
            author: { id: "user2" },
            content: "User2: Valid reply to message 1",
            edited_timestamp: null,
            message_reference: { message_id: "1" },
          },
          {
            type: 19,
            id: "3",
            author: { id: "user3" },
            content: "User3: Orphaned reply",
            edited_timestamp: null,
            message_reference: { message_id: "999" },
          },
        ]),
      ),
    );

    const messages = await getChannelMessages();

    expect(messages).toMatchObject([{ id: "1", replies: [{ id: "2" }] }]);
  });

  it("should filter out non-standard message types", async () => {
    server.use(
      http.get(`${DISCORD_BASE_URL}/channels/:channelId/messages`, () =>
        HttpResponse.json([
          {
            type: 0,
            id: "1",
            author: { id: "user1" },
            content: "User: Normal message",
            edited_timestamp: null,
          },
          {
            type: 7,
            id: "2",
            author: { id: "user2" },
            content: "User joined",
            edited_timestamp: null,
          },
          {
            type: 18,
            id: "3",
            author: { id: "user3" },
            content: "Thread created",
            edited_timestamp: null,
          },
        ]),
      ),
    );

    const messages = await getChannelMessages();

    expect(messages).toMatchObject([{ id: "1" }]);
  });

  it("should sort messages by ID", async () => {
    server.use(
      http.get(`${DISCORD_BASE_URL}/channels/:channelId/messages`, () =>
        HttpResponse.json([
          {
            type: 0,
            id: "3",
            author: { id: "user1" },
            content: "User: Third",
            edited_timestamp: null,
          },
          {
            type: 0,
            id: "1",
            author: { id: "user1" },
            content: "User: First",
            edited_timestamp: null,
          },
          {
            type: 0,
            id: "2",
            author: { id: "user1" },
            content: "User: Second",
            edited_timestamp: null,
          },
        ]),
      ),
    );

    const messages = await getChannelMessages();

    expect(messages.map((m) => m.id)).toEqual(["1", "2", "3"]);
  });

  it("should configure fetch with 5 second timeout", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");

    server.use(
      http.get(`${DISCORD_BASE_URL}/channels/:channelId/messages`, () =>
        HttpResponse.json([]),
      ),
    );

    await getChannelMessages();

    expect(timeoutSpy).toHaveBeenCalledWith(5000);
    timeoutSpy.mockRestore();
  });

  it.each([
    { status: 401, statusText: "Unauthorized" },
    { status: 403, statusText: "Forbidden" },
    { status: 404, statusText: "Not Found" },
    { status: 500, statusText: "Internal Server Error" },
  ])("should handle HTTP $status error", async ({ status, statusText }) => {
    vi.spyOn(log, "error").mockImplementation(() => {});

    server.use(
      http.get(
        `${DISCORD_BASE_URL}/channels/:channelId/messages`,
        () => new HttpResponse(JSON.stringify({}), { status, statusText }),
      ),
    );

    await expect(getChannelMessages()).rejects.toThrow(
      `Discord API error: ${status} ${statusText}`,
    );
  });

  it("should handle invalid response schema", async () => {
    server.use(
      http.get(`${DISCORD_BASE_URL}/channels/:channelId/messages`, () =>
        HttpResponse.json({ invalid: "data" }),
      ),
    );

    await expect(getChannelMessages()).rejects.toThrow();
  });
});

describe("postChannelMessage", () => {
  it("should post message with username prefix", async () => {
    server.use(
      http.post(
        `${DISCORD_BASE_URL}/channels/:channelId/messages`,
        async ({ request }) => {
          const body = (await request.json()) as { content: string };
          expect(body.content).toBe("TestUser: Hello world");
          expect(request.headers.get("Authorization")).toBe(
            "Bot test-discord-bot-token",
          );
          return HttpResponse.json({ id: "123" });
        },
      ),
    );

    await postChannelMessage("Hello world", "TestUser" as Username);
  });

  it.each([
    { status: 401, statusText: "Unauthorized" },
    { status: 403, statusText: "Forbidden" },
    { status: 500, statusText: "Internal Server Error" },
  ])("should handle HTTP $status error", async ({ status, statusText }) => {
    vi.spyOn(log, "error").mockImplementation(() => {});

    server.use(
      http.post(
        `${DISCORD_BASE_URL}/channels/:channelId/messages`,
        () => new HttpResponse(JSON.stringify({}), { status, statusText }),
      ),
    );

    await expect(
      postChannelMessage("Hello", "TestUser" as Username),
    ).rejects.toThrow(`Discord API error: ${status} ${statusText}`);
  });
});
