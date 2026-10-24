import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { identifiers } from "@/lib/identifiers";
import { log } from "@/lib/log";
import { encrypt, type Username } from "@/lib/session";
import { setTyping } from "@/lib/siteTyping";
import { mockCookieJar } from "@/mocks/headers";
import { loadDenyList } from "@/mocks/ipDenyList";

import { POST } from "./route";

vi.mock(import("next/headers"), () => ({ cookies: vi.fn() }));
vi.mock(import("@/lib/identifiers"), async (importOriginal) => ({
  ...(await importOriginal()),
  identifiers: vi.fn(() =>
    Promise.resolve({ ip: "1.1.1.1", userAgent: "vitest" }),
  ),
}));
vi.mock(import("@/lib/siteTyping"), () => ({
  setTyping: vi.fn(() => Promise.resolve()),
}));

const post = (body: string) =>
  POST(
    new NextRequest("http://localhost/api/chat/typing", {
      method: "POST",
      body,
    }),
  );

describe("POST /api/chat/typing", () => {
  beforeEach(async () => {
    mockCookieJar(`session=${await encrypt({ username: "bob" as Username })}`);
    await loadDenyList("6.6.6.6");
  });

  it("marks the session's visitor as typing", async () => {
    const response = await post(`{"typing":true}`);

    expect(response.status).toBe(204);
    expect(setTyping).toHaveBeenCalledExactlyOnceWith("bob", true);
  });

  it("turns away a visitor without a session", async () => {
    mockCookieJar();

    expect((await post(`{"typing":true}`)).status).toBe(401);
    expect(setTyping).not.toHaveBeenCalled();
  });

  it("turns away a listed IP", async () => {
    vi.mocked(identifiers).mockResolvedValue({
      ip: "6.6.6.6",
      userAgent: "vitest",
    });

    expect((await post(`{"typing":true}`)).status).toBe(403);
    expect(setTyping).not.toHaveBeenCalled();
  });

  it.each(["", `{"typing":"yes"}`])("rejects the body %j", async (body) => {
    expect((await post(body)).status).toBe(400);
    expect(setTyping).not.toHaveBeenCalled();
  });

  it("answers 503 when it can't store the ping", async () => {
    vi.mocked(setTyping).mockRejectedValue(new Error("boom"));

    expect((await post(`{"typing":false}`)).status).toBe(503);
    expect(log.warn).toHaveBeenCalledWith(
      { err: new Error("boom") },
      "Failed to store typing",
    );
  });
});
