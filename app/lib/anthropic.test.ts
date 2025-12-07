import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { server } from "@/mocks/node";

import { createMessage } from "./anthropic";

vi.mock(import("server-only"), () => ({}));

const ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1/messages";

describe("createMessage", () => {
  it("should create message and return text content", async () => {
    server.use(
      http.post(ANTHROPIC_BASE_URL, async ({ request }) => {
        const body = (await request.json()) as {
          model: string;
          max_tokens: number;
          system: string;
          messages: Array<{ role: string; content: string }>;
        };

        expect(body.model).toBe("claude-haiku-4-5");
        expect(body.max_tokens).toBe(300);
        expect(body.system).toContain("simon-bot");
        expect(body.messages).toEqual([
          { role: "user", content: "Hello, bot!" },
        ]);
        expect(request.headers.get("x-api-key")).toBe("test-anthropic-api-key");
        expect(request.headers.get("anthropic-version")).toBe("2023-06-01");

        return HttpResponse.json({
          id: "msg_123",
          type: "message",
          role: "assistant",
          model: "claude-haiku-4-5",
          content: [{ type: "text", text: "Hello! How can I help you?" }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 20 },
        });
      }),
    );

    const response = await createMessage("Hello, bot!");

    expect(response).toBe("Hello! How can I help you?");
  });

  it("should configure fetch with 5 second timeout", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");

    server.use(
      http.post(ANTHROPIC_BASE_URL, () =>
        HttpResponse.json({
          id: "msg_123",
          type: "message",
          role: "assistant",
          model: "claude-haiku-4-5",
          content: [{ type: "text", text: "Response" }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      ),
    );

    await createMessage("Test");

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

    await expect(createMessage("Test")).rejects.toThrow(
      `Anthropic API error: ${status} ${statusText}`,
    );
  });

  it("should handle invalid response schema", async () => {
    server.use(
      http.post(ANTHROPIC_BASE_URL, () =>
        HttpResponse.json({ invalid: "data" }),
      ),
    );

    await expect(createMessage("Test")).rejects.toThrow();
  });

  it("should handle response with no content blocks", async () => {
    server.use(
      http.post(ANTHROPIC_BASE_URL, () =>
        HttpResponse.json({
          id: "msg_123",
          type: "message",
          role: "assistant",
          model: "claude-haiku-4-5",
          content: [],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 0 },
        }),
      ),
    );

    await expect(createMessage("Test")).rejects.toThrow(
      "No text content in response",
    );
  });

  it("should handle response with non-text content block", async () => {
    server.use(
      http.post(ANTHROPIC_BASE_URL, () =>
        HttpResponse.json({
          id: "msg_123",
          type: "message",
          role: "assistant",
          model: "claude-haiku-4-5",
          content: [{ type: "tool_use", id: "123", name: "test", input: {} }],
          stop_reason: "tool_use",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      ),
    );

    await expect(createMessage("Test")).rejects.toThrow(
      "No text content in response",
    );
  });
});
