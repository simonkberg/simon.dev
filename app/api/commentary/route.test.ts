import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import { isBanned } from "@/lib/bans";
import { getCommentary, writeCommentary } from "@/lib/commentary";
import { identifiers } from "@/lib/identifiers";
import { isDeniedRequest } from "@/lib/ipDenyList";
import { log } from "@/lib/log";
import { rateLimit } from "@/lib/rateLimit";

import { GET, POST } from "./route";

vi.mock(import("@/lib/commentary"), async (importOriginal) => ({
  ...(await importOriginal()),
  getCommentary: vi.fn(async () => ({
    status: "ok" as const,
    text: undefined,
  })),
  writeCommentary: vi.fn(async () => "frog ate the week"),
}));
vi.mock(import("@/lib/today"), () => ({
  getToday: vi.fn(async () => "2026-10-31" as const),
}));
vi.mock(import("@/lib/identifiers"), async (importOriginal) => ({
  ...(await importOriginal()),
  identifiers: vi.fn(async () => ({ ip: "2001:db8::1", userAgent: undefined })),
}));
vi.mock(import("@/lib/ipDenyList"), () => ({
  isDeniedRequest: vi.fn(() => false),
}));
vi.mock(import("@/lib/bans"), () => ({ isBanned: vi.fn(async () => false) }));
vi.mock(import("@/lib/rateLimit"), () => ({
  rateLimit: vi.fn(async () => ({ success: true as const })),
}));

const request = (page: string, method = "GET") =>
  new NextRequest(`http://localhost/api/commentary?page=${page}`, { method });

describe("GET /api/commentary", () => {
  it("should answer with the stored comment", async () => {
    vi.mocked(getCommentary).mockResolvedValueOnce({
      status: "ok",
      text: "frog ate the week",
    });

    const response = await GET(request("7day"));

    expect(getCommentary).toHaveBeenCalledWith("7day");
    await expect(response.json()).resolves.toEqual({
      text: "frog ate the week",
    });
  });

  it("should answer no content when none is stored", async () => {
    expect((await GET(request("2019-03-04"))).status).toBe(204);
  });

  it("should not find a page without a comment", async () => {
    expect((await GET(request("2026-11-01"))).status).toBe(404);
    expect(getCommentary).not.toHaveBeenCalled();
  });

  it("should answer unavailable when the read fails", async () => {
    vi.mocked(getCommentary).mockResolvedValueOnce({
      status: "error",
      error: "Failed to read commentary",
    });

    expect((await GET(request("7day"))).status).toBe(503);
  });
});

describe("POST /api/commentary", () => {
  it("should write the comment, limited per network", async () => {
    const response = await POST(request("7day", "POST"));

    expect(writeCommentary).toHaveBeenCalledWith("7day");
    expect(rateLimit).toHaveBeenCalledWith("commentary:2001:db8:0:0::/64", {
      limit: 20,
      windowMs: 3_600_000,
    });
    await expect(response.json()).resolves.toEqual({
      text: "frog ate the week",
    });
  });

  it("should answer with a stored comment without counting it", async () => {
    vi.mocked(getCommentary).mockResolvedValueOnce({
      status: "ok",
      text: "already here",
    });

    const response = await POST(request("7day", "POST"));

    await expect(response.json()).resolves.toEqual({ text: "already here" });
    expect(rateLimit).not.toHaveBeenCalled();
    expect(writeCommentary).not.toHaveBeenCalled();
  });

  it("should skip the limits without a client address", async () => {
    vi.mocked(identifiers).mockResolvedValueOnce({
      ip: undefined,
      userAgent: undefined,
    });

    expect((await POST(request("7day", "POST"))).status).toBe(200);
    expect(rateLimit).not.toHaveBeenCalled();
  });

  it.each([
    ["a listed IP", () => vi.mocked(isDeniedRequest).mockReturnValueOnce(true)],
    ["a banned one", () => vi.mocked(isBanned).mockResolvedValueOnce(true)],
  ])("should turn away %s", async (_, deny) => {
    deny();

    expect((await POST(request("7day", "POST"))).status).toBe(403);
    expect(writeCommentary).not.toHaveBeenCalled();
  });

  it("should turn away a network over its limit", async () => {
    vi.mocked(rateLimit).mockResolvedValueOnce({
      success: false,
      retryAfterSeconds: 42,
    });

    const response = await POST(request("7day", "POST"));

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("42");
  });

  it("should not find a page without a comment", async () => {
    expect((await POST(request("someday", "POST"))).status).toBe(404);
  });

  it("should answer no content when no comment came of it", async () => {
    vi.mocked(writeCommentary).mockResolvedValueOnce(undefined);

    expect((await POST(request("2026-10-31", "POST"))).status).toBe(204);
  });

  it("should log a failed write", async () => {
    const err = new Error("cut off");
    vi.mocked(writeCommentary).mockRejectedValueOnce(err);

    expect((await POST(request("7day", "POST"))).status).toBe(503);
    expect(log.error).toHaveBeenCalledWith(
      { err, page: "7day" },
      "Failed to write commentary",
    );
  });
});
