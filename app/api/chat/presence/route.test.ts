// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { leavePresence } from "@/lib/presence";
import { encrypt, type Username } from "@/lib/session";
import { mockCookieJar } from "@/mocks/headers";

import { POST } from "./route";

vi.mock(import("next/headers"), () => ({ cookies: vi.fn() }));
vi.mock(import("@/lib/presence"), () => ({ leavePresence: vi.fn() }));

const stream = "6f1c2a52-8e4b-4c55-9f60-0f6f9c1a7b3e";

const post = (body: string) =>
  POST(
    new Request("http://localhost/api/chat/presence", { method: "POST", body }),
  );

describe("POST /api/chat/presence", () => {
  it("takes the visitor's stream out of presence", async () => {
    mockCookieJar(
      `session=${await encrypt({ username: "alice" as Username })}`,
    );

    const response = await post(stream);

    expect(response.status).toBe(204);
    expect(leavePresence).toHaveBeenCalledExactlyOnceWith(stream, "alice");
  });

  it.each([
    ["no session", undefined, stream],
    ["a body that isn't a stream id", "alice", "not-a-stream"],
  ])("refuses %s", async (_, username, body) => {
    mockCookieJar(
      username &&
        `session=${await encrypt({ username: username as Username })}`,
    );

    const response = await post(body);

    expect(response.status).toBe(400);
    expect(leavePresence).not.toHaveBeenCalled();
  });
});
