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
        expect(await request.json()).toEqual({
          model: "claude-haiku-4-5",
          max_tokens: 300,
          system: expect.stringContaining("simon-bot"),
          messages: [{ role: "user", content: "Hello, bot!" }],
          tool_choice: { type: "none" },
        });
        expect(request.headers.get("x-api-key")).toBe("test-anthropic-api-key");
        expect(request.headers.get("anthropic-version")).toBe("2023-06-01");

        return HttpResponse.json({
          content: [{ type: "text", text: "Hello! How can I help you?" }],
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
        HttpResponse.json({ content: [{ type: "text", text: "Response" }] }),
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
      http.post(ANTHROPIC_BASE_URL, () => HttpResponse.json({ content: [] })),
    );

    await expect(createMessage("Test")).rejects.toThrow(
      "No text content in response",
    );
  });

  it("should handle response with non-text content block", async () => {
    server.use(
      http.post(ANTHROPIC_BASE_URL, () =>
        HttpResponse.json({
          content: [{ type: "tool_use", id: "123", name: "test", input: {} }],
        }),
      ),
    );

    await expect(createMessage("Test")).rejects.toThrow(
      "No text content in response",
    );
  });
});
