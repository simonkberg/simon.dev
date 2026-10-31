import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { admit } from "@/lib/admission";
import { getCommentary, writeCommentary } from "@/lib/commentary";
import { log } from "@/lib/log";
import { encrypt, type Username } from "@/lib/session";
import { mockCookieJar } from "@/mocks/headers";

import { GET, POST } from "./route";

vi.mock(import("@/lib/commentary"), async (importOriginal) => ({
  ...(await importOriginal()),
  getCommentary: vi.fn(async () => ({
    status: "ok" as const,
    text: undefined,
  })),
  writeCommentary: vi.fn(async () => "frog ate the week"),
}));
vi.mock(import("next/headers"), () => ({ cookies: vi.fn() }));
vi.mock(import("@/lib/identifiers"), async (importOriginal) => ({
  ...(await importOriginal()),
  identifiers: vi.fn(async () => ({ ip: "2001:db8::1", userAgent: undefined })),
}));
vi.mock(import("@/lib/admission"), () => ({
  admit: vi.fn(async () => undefined),
}));

beforeEach(() => {
  // Noon in Stockholm.
  vi.useFakeTimers({ now: new Date("2026-10-31T11:00:00Z"), toFake: ["Date"] });
});

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

  it("should not find a day whose plays are still coming in", async () => {
    expect((await GET(request("2026-10-31"))).status).toBe(404);
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
  beforeEach(async () => {
    mockCookieJar(`session=${await encrypt({ username: "bob" as Username })}`);
  });

  it("should write the comment, limited per network", async () => {
    const response = await POST(request("7day", "POST"));

    expect(writeCommentary).toHaveBeenCalledWith("7day", {
      signal: expect.any(AbortSignal),
    });
    expect(admit).toHaveBeenCalledWith("commentary", "2001:db8::1", "bob", {
      limit: 10,
      windowMs: 60_000,
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
    expect(admit).not.toHaveBeenCalled();
    expect(writeCommentary).not.toHaveBeenCalled();
  });

  it.each(["denied", "banned"] as const)(
    "should turn away a request that is %s",
    async (reason) => {
      vi.mocked(admit).mockResolvedValueOnce({ reason });

      expect((await POST(request("7day", "POST"))).status).toBe(403);
      expect(writeCommentary).not.toHaveBeenCalled();
    },
  );

  it("should turn away a network over its limit", async () => {
    vi.mocked(admit).mockResolvedValueOnce({
      reason: "limited",
      retryAfterSeconds: 42,
    });

    const response = await POST(request("7day", "POST"));

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("42");
  });

  it("should turn away a request without a session", async () => {
    mockCookieJar();

    expect((await POST(request("7day", "POST"))).status).toBe(401);
    expect(admit).not.toHaveBeenCalled();
  });

  it("should not find a page without a comment", async () => {
    expect((await POST(request("someday", "POST"))).status).toBe(404);
  });

  it("should answer no content when no comment came of it", async () => {
    vi.mocked(writeCommentary).mockResolvedValueOnce(undefined);

    expect((await POST(request("7day", "POST"))).status).toBe(204);
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
