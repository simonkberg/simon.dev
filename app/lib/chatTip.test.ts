import { cookies } from "next/headers";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MockCookies } from "@/mocks/headers";

import { getChatTipDismissed, setChatTipDismissed } from "./chatTip";

vi.mock(import("server-only"), () => ({}));

vi.mock(import("next/headers"), () => ({ cookies: vi.fn() }));

describe("chatTip", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  /** Returns the headers so tests can read back what was set. */
  const mockCookies = (cookie?: string) => {
    const headers = new Headers(cookie ? { cookie } : undefined);
    vi.mocked(cookies).mockResolvedValue(new MockCookies(headers));

    return headers;
  };

  describe("getChatTipDismissed", () => {
    it("is true when the cookie is set", async () => {
      mockCookies("chatTipDismissed=true");

      await expect(getChatTipDismissed()).resolves.toBe(true);
    });

    it("is false when the cookie is absent", async () => {
      mockCookies();

      await expect(getChatTipDismissed()).resolves.toBe(false);
    });

    it("is false for any other cookie value", async () => {
      mockCookies("chatTipDismissed=nope");

      await expect(getChatTipDismissed()).resolves.toBe(false);
    });
  });

  describe("setChatTipDismissed", () => {
    it("writes the dismissal cookie", async () => {
      const headers = mockCookies();

      await setChatTipDismissed();

      const setCookie = headers.get("set-cookie");
      expect(setCookie).toContain("chatTipDismissed=true");
    });

    it("does not rewrite an already-dismissed cookie", async () => {
      const headers = mockCookies("chatTipDismissed=true");

      await setChatTipDismissed();

      expect(headers.get("set-cookie")).toBeNull();
    });
  });
});
