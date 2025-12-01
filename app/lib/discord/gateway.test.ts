// @vitest-environment node

import { ws } from "msw";
import { describe, expect, it, vi } from "vitest";

import { server } from "@/mocks/node";

import { subscribe } from "./gateway";

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

  it("should complete handshake and resolve", async () => {
    server.use(
      gateway.addEventListener("connection", ({ client }) => {
        // Send Hello immediately on connection
        client.send(
          createPayload(GatewayOpcode.HELLO, { heartbeat_interval: 45000 }),
        );

        client.addEventListener("message", (event) => {
          const payload = JSON.parse(String(event.data)) as {
            op: number;
            d: unknown;
          };

          if (payload.op === GatewayOpcode.IDENTIFY) {
            // Respond to Identify with Ready
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
});
