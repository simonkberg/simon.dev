import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { server } from "@/mocks/node";

import { createMessage } from "./anthropic";

vi.mock(import("server-only"), () => ({}));

const ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1/messages";

async function collectResponses(
  generator: AsyncGenerator<string, void, unknown>,
): Promise<string[]> {
  const results: string[] = [];
  for await (const text of generator) {
    results.push(text);
  }
  return results;
}

describe("createMessage", () => {
  it("should create message and yield text content", async () => {
    server.use(
      http.post(ANTHROPIC_BASE_URL, async ({ request }) => {
        const body = await request.json();
        expect(body).toMatchObject({
          model: "claude-haiku-4-5",
          max_tokens: 500,
          system: expect.stringContaining("simon-bot"),
          messages: [{ role: "user", content: "Hello, bot!" }],
        });
        expect(body).toHaveProperty("tools");
        expect(request.headers.get("x-api-key")).toBe("test-anthropic-api-key");
        expect(request.headers.get("anthropic-version")).toBe("2023-06-01");

        return HttpResponse.json({
          content: [{ type: "text", text: "Hello! How can I help you?" }],
          stop_reason: "end_turn",
        });
      }),
    );

    const responses = await collectResponses(createMessage("Hello, bot!"));

    expect(responses).toEqual(["Hello! How can I help you?"]);
  });

  it("should configure fetch with 5 second timeout", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");

    server.use(
      http.post(ANTHROPIC_BASE_URL, () =>
        HttpResponse.json({
          content: [{ type: "text", text: "Response" }],
          stop_reason: "end_turn",
        }),
      ),
    );

    await collectResponses(createMessage("Test"));

    expect(timeoutSpy).toHaveBeenCalledWith(5000);
    timeoutSpy.mockRestore();
  });

  it.each([
    { status: 400, statusText: "Bad Request" },
    { status: 401, statusText: "Unauthorized" },
    { status: 429, statusText: "Too Many Requests" },
    { status: 500, statusText: "Internal Server Error" },
  ])("should handle HTTP $status error", async ({ status, statusText }) => {
    server.use(
      http.post(
        ANTHROPIC_BASE_URL,
        () => new HttpResponse(null, { status, statusText }),
      ),
    );

    await expect(collectResponses(createMessage("Test"))).rejects.toThrow(
      `Anthropic API error: ${status} ${statusText}`,
    );
  });

  it("should handle invalid response schema", async () => {
    server.use(
      http.post(ANTHROPIC_BASE_URL, () =>
        HttpResponse.json({ invalid: "data" }),
      ),
    );

    await expect(collectResponses(createMessage("Test"))).rejects.toThrow();
  });

  it("should handle response with no content blocks", async () => {
    server.use(
      http.post(ANTHROPIC_BASE_URL, () =>
        HttpResponse.json({ content: [], stop_reason: "end_turn" }),
      ),
    );

    const responses = await collectResponses(createMessage("Test"));
    expect(responses).toEqual([]);
  });
});
