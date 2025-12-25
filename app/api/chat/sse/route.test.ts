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

import { subscribe } from "@/lib/discord/gateway";

import { GET } from "./route";

vi.mock(import("next/server"), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, connection: vi.fn() };
});

vi.mock(import("@/lib/discord/gateway"), () => ({ subscribe: vi.fn() }));

function createRequest(signal: AbortSignal) {
  return new NextRequest("http://localhost/api/chat/sse", { signal });
}

describe("GET /api/chat/sse", () => {
  let mockUnsubscribe: Mock;

  beforeEach(() => {
    vi.useFakeTimers();
    mockUnsubscribe = vi.fn();
    vi.mocked(subscribe).mockResolvedValue(mockUnsubscribe);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("should return SSE response with correct headers", async () => {
    const controller = new AbortController();
    const response = await GET(createRequest(controller.signal));

    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(response.headers.get("Connection")).toBe("keep-alive");
    expect(response.headers.get("Cache-Control")).toBe(
      "no-cache, no-transform",
    );
    expect(connection).toHaveBeenCalledOnce();

    controller.abort();
  });

  it("should send initial ping on connection", async () => {
    const controller = new AbortController();
    const response = await GET(createRequest(controller.signal));

    const reader = response.body!.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);

    expect(text).toBe(": ping\n\n");

    controller.abort();
    reader.releaseLock();
  });

  it("should subscribe to gateway events", async () => {
    const controller = new AbortController();
    await GET(createRequest(controller.signal));

    expect(subscribe).toHaveBeenCalledOnce();
    expect(subscribe).toHaveBeenCalledWith(expect.any(Function));

    controller.abort();
  });

  it("should send refresh event when gateway notifies", async () => {
    const controller = new AbortController();
    const response = await GET(createRequest(controller.signal));

    // Get the callback passed to subscribe
    const onMessage = vi.mocked(subscribe).mock.calls[0]![0];

    const reader = response.body!.getReader();

    // Read initial ping
    await reader.read();

    // Trigger gateway notification
    onMessage();

    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);

    expect(text).toBe("data: refresh\n\n");

    controller.abort();
    reader.releaseLock();
  });

  it("should send periodic pings every 30 seconds", async () => {
    const controller = new AbortController();
    const response = await GET(createRequest(controller.signal));

    const reader = response.body!.getReader();

    // Read initial ping
    await reader.read();

    // Advance 30 seconds
    await vi.advanceTimersByTimeAsync(30_000);

    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);

    expect(text).toBe(": ping\n\n");

    controller.abort();
    reader.releaseLock();
  });

  it("should cleanup on abort", async () => {
    const controller = new AbortController();
    await GET(createRequest(controller.signal));

    expect(mockUnsubscribe).not.toHaveBeenCalled();

    controller.abort();

    expect(mockUnsubscribe).toHaveBeenCalledOnce();
  });

  it("should not write after abort", async () => {
    const controller = new AbortController();
    const response = await GET(createRequest(controller.signal));

    const onMessage = vi.mocked(subscribe).mock.calls[0]![0];

    controller.abort();

    // These should be no-ops after abort
    onMessage();
    await vi.advanceTimersByTimeAsync(30_000);

    // Stream should be closed, reading should complete
    const reader = response.body!.getReader();
    // Read initial ping that was sent before abort
    await reader.read();
    // Stream should be done
    const { done } = await reader.read();
    expect(done).toBe(true);

    reader.releaseLock();
  });
});
