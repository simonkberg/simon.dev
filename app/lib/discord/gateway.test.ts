// @vitest-environment node

import { ws } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { server } from "@/mocks/node";

vi.mock(import("server-only"), () => ({}));

const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";

const GatewayOpcode = {
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  RESUME: 6,
  RECONNECT: 7,
  INVALID_SESSION: 9,
  HELLO: 10,
  HEARTBEAT_ACK: 11,
} as const;

function createPayload(
  op: number,
  d: unknown,
  s: number | null = null,
  t: string | null = null,
) {
  return JSON.stringify({ op, d, s, t });
}

describe("subscribe", () => {
  const gateway = ws.link(GATEWAY_URL);

  // Reset module state between tests to get fresh gateway singleton
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    // Make jitter deterministic (0 jitter)
    vi.spyOn(Math, "random").mockReturnValue(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("should complete handshake and resolve", async () => {
    const { subscribe } = await import("./gateway");

    server.use(
      gateway.addEventListener("connection", ({ client }) => {
        client.send(
          createPayload(GatewayOpcode.HELLO, { heartbeat_interval: 45000 }),
        );

        client.addEventListener("message", (event) => {
          const payload = JSON.parse(String(event.data)) as {
            op: number;
            d: unknown;
          };

          if (payload.op === GatewayOpcode.IDENTIFY) {
            client.send(
              createPayload(
                GatewayOpcode.DISPATCH,
                {
                  session_id: "test-session-id",
                  resume_gateway_url: "wss://gateway.discord.gg",
                },
                1,
                "READY",
              ),
            );
          }
        });
      }),
    );

    const callback = vi.fn();
    const unsubscribe = await subscribe(callback);

    expect(unsubscribe).toBeTypeOf("function");
  });

  it("should send heartbeat after interval", async () => {
    const { subscribe } = await import("./gateway");
    const receivedMessages: Array<{ op: number; d: unknown }> = [];

    server.use(
      gateway.addEventListener("connection", ({ client }) => {
        client.send(
          createPayload(GatewayOpcode.HELLO, { heartbeat_interval: 1000 }),
        );

        client.addEventListener("message", (event) => {
          const payload = JSON.parse(String(event.data)) as {
            op: number;
            d: unknown;
          };
          receivedMessages.push(payload);

          if (payload.op === GatewayOpcode.IDENTIFY) {
            client.send(
              createPayload(
                GatewayOpcode.DISPATCH,
                {
                  session_id: "test-session-id",
                  resume_gateway_url: "wss://gateway.discord.gg",
                },
                1,
                "READY",
              ),
            );
          }
        });
      }),
    );

    await subscribe(vi.fn());

    // Clear the IDENTIFY message
    receivedMessages.length = 0;

    // Advance time past the heartbeat interval (with 0 jitter)
    await vi.advanceTimersByTimeAsync(1000);

    expect(receivedMessages).toContainEqual({
      op: GatewayOpcode.HEARTBEAT,
      d: 1, // sequence number from READY event
    });
  });
});
