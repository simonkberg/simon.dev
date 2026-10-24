import { connection, NextRequest } from "next/server";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";

import { subscribeToChannel } from "@/lib/discord/api";
import { subscribeToStatus } from "@/lib/discord/gateway";
import { joinPresence } from "@/lib/presence";
import { encrypt, type Username } from "@/lib/session";
import { mockCookieJar } from "@/mocks/headers";

import { GET } from "./route";

vi.mock(import("next/server"), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, connection: vi.fn() };
});

vi.mock(import("@/lib/discord/api"), () => ({ subscribeToChannel: vi.fn() }));

vi.mock(import("@/lib/discord/gateway"), () => ({
  subscribeToStatus: vi.fn(),
}));

vi.mock(import("next/headers"), () => ({ cookies: vi.fn() }));

vi.mock(import("@/lib/presence"), () => ({ joinPresence: vi.fn() }));

const decoder = new TextDecoder();

async function readText(reader: ReadableStreamDefaultReader<Uint8Array>) {
  return decoder.decode((await reader.read()).value);
}

describe("GET /api/chat/sse", () => {
  let controller: AbortController;
  let mockUnsubscribe: Mock;
  let mockUnsubscribeStatus: Mock;
  let mockLeavePresence: Mock;

  function open() {
    return GET(
      new NextRequest("http://localhost/api/chat/sse", {
        signal: controller.signal,
      }),
    );
  }

  async function openReader() {
    const response = await open();
    return response.body!.getReader();
  }

  beforeEach(() => {
    vi.useFakeTimers();
    mockCookieJar();
    controller = new AbortController();
    mockUnsubscribe = vi.fn();
    mockUnsubscribeStatus = vi.fn();
    mockLeavePresence = vi.fn();
    vi.mocked(joinPresence).mockReturnValue(mockLeavePresence);
    vi.mocked(subscribeToChannel).mockResolvedValue(mockUnsubscribe);
    vi.mocked(subscribeToStatus).mockReturnValue(mockUnsubscribeStatus);
  });

  afterEach(() => {
    controller.abort();
  });

  it("should return SSE response with correct headers", async () => {
    const response = await open();

    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(response.headers.get("Connection")).toBe("keep-alive");
    expect(response.headers.get("Cache-Control")).toBe(
      "no-cache, no-transform",
    );
    expect(connection).toHaveBeenCalledOnce();
  });

  it("should send initial ping on connection", async () => {
    const reader = await openReader();

    expect(await readText(reader)).toBe(": ping\n\n");
  });

  it("should send refresh event when gateway notifies", async () => {
    const reader = await openReader();
    expect(subscribeToChannel).toHaveBeenCalledOnce();
    const onMessage = vi.mocked(subscribeToChannel).mock.calls[0]![0];
    await reader.read();

    onMessage();

    expect(await readText(reader)).toBe("data: refresh\n\n");
  });

  it("should send status events when the gateway drops and recovers", async () => {
    const reader = await openReader();
    const onStatus = vi.mocked(subscribeToStatus).mock.calls[0]![0];
    await reader.read();

    onStatus(false);
    expect(await readText(reader)).toBe("event: status\ndata: connecting\n\n");

    onStatus(true);
    expect(await readText(reader)).toBe("event: status\ndata: live\n\n");
  });

  it.each([
    { here: ["alice", "bob", "carol"], sent: ["you", "alice", "carol"] },
    { here: ["alice"], sent: ["alice"] },
  ])(
    "should count the session's visitor and send who is here, as you",
    async ({ here, sent }) => {
      mockCookieJar(
        `session=${await encrypt({ username: "bob" as Username })}`,
      );
      const response = await open();
      const reader = response.body!.getReader();
      const [username, onPresence] = vi.mocked(joinPresence).mock.calls[0]!;
      await reader.read();

      onPresence(here);

      expect(username).toBe("bob");
      expect(await readText(reader)).toBe(
        `event: presence\ndata: ${JSON.stringify(sent)}\n\n`,
      );
    },
  );

  it("should send periodic pings every 5 seconds", async () => {
    const reader = await openReader();
    await reader.read();

    await vi.advanceTimersByTimeAsync(5_000);

    expect(await readText(reader)).toBe(": ping\n\n");
  });

  it("should return 503 without a ping interval when subscribing fails", async () => {
    vi.mocked(subscribeToChannel).mockRejectedValue(
      new Error("Gateway closed"),
    );

    const response = await open();

    expect(response.status).toBe(503);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("should unsubscribe when the client left while subscribing", async () => {
    vi.mocked(subscribeToChannel).mockImplementation(async () => {
      controller.abort();
      return mockUnsubscribe;
    });

    const response = await open();

    expect(response.status).toBe(499);
    expect(mockUnsubscribe).toHaveBeenCalledOnce();
    expect(subscribeToStatus).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("should cleanup on abort", async () => {
    await open();

    expect(mockUnsubscribe).not.toHaveBeenCalled();
    expect(mockUnsubscribeStatus).not.toHaveBeenCalled();
    expect(mockLeavePresence).not.toHaveBeenCalled();

    controller.abort();

    expect(mockUnsubscribe).toHaveBeenCalledOnce();
    expect(mockUnsubscribeStatus).toHaveBeenCalledOnce();
    expect(mockLeavePresence).toHaveBeenCalledOnce();
  });

  it("should not write after abort", async () => {
    const reader = await openReader();
    const onMessage = vi.mocked(subscribeToChannel).mock.calls[0]![0];
    const onStatus = vi.mocked(subscribeToStatus).mock.calls[0]![0];
    const [, onPresence] = vi.mocked(joinPresence).mock.calls[0]!;

    controller.abort();
    onMessage();
    onStatus(false);
    onPresence([]);
    await vi.advanceTimersByTimeAsync(5_000);

    // Only the ping written on connect, before the abort, reaches the client.
    expect(await readText(reader)).toBe(": ping\n\n");
    expect((await reader.read()).done).toBe(true);
  });
});
