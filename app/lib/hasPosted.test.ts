import { cookies } from "next/headers";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getHasPosted, setHasPosted } from "@/lib/hasPosted";

vi.mock(import("server-only"), () => ({}));
vi.mock(import("next/headers"), () => ({ cookies: vi.fn() }));

const mockCookieJar = (value?: string) => {
  const set = vi.fn();

  vi.mocked(cookies).mockResolvedValue({
    get: vi.fn(() => (value === undefined ? undefined : { name: "x", value })),
    set,
  } as unknown as Awaited<ReturnType<typeof cookies>>);

  return set;
};

describe("hasPosted", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("getHasPosted", () => {
    it("is true when the cookie is set", async () => {
      mockCookieJar("true");

      await expect(getHasPosted()).resolves.toBe(true);
    });

    it("is false when the cookie is absent", async () => {
      mockCookieJar();

      await expect(getHasPosted()).resolves.toBe(false);
    });

    it("is false for any other cookie value", async () => {
      mockCookieJar("nope");

      await expect(getHasPosted()).resolves.toBe(false);
    });
  });

  describe("setHasPosted", () => {
    it("writes an httpOnly cookie and reports the change", async () => {
      const set = mockCookieJar();

      await expect(setHasPosted()).resolves.toBe(true);
      expect(set).toHaveBeenCalledWith(
        "hasPosted",
        "true",
        expect.objectContaining({ httpOnly: true, path: "/" }),
      );
    });

    it("does nothing when already recorded", async () => {
      const set = mockCookieJar("true");

      await expect(setHasPosted()).resolves.toBe(false);
      expect(set).not.toHaveBeenCalled();
    });
  });
});
