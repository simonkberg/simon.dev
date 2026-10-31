import { describe, expect, it, vi } from "vitest";

import { isBanned } from "@/lib/bans";
import { isDeniedRequest } from "@/lib/ipDenyList";
import { log } from "@/lib/log";
import { rateLimit } from "@/lib/rateLimit";

import { admit } from "./admission";

vi.mock(import("@/lib/bans"), () => ({ isBanned: vi.fn(async () => false) }));
vi.mock(import("@/lib/ipDenyList"), () => ({
  isDeniedRequest: vi.fn(() => false),
}));
vi.mock(import("@/lib/rateLimit"), () => ({
  rateLimit: vi.fn(async () => ({ success: true as const })),
}));

const limits = { limit: 10, windowMs: 60_000 };

describe("admit", () => {
  it("should admit a request under its limit, keyed by network", async () => {
    await expect(
      admit("chat", "2001:db8::1", "bob", limits),
    ).resolves.toBeUndefined();

    expect(rateLimit).toHaveBeenCalledWith("chat:2001:db8:0:0::/64", limits);
  });

  it("should key a request without an IP by its fallback", async () => {
    await admit("chat", undefined, "bob", limits);

    expect(rateLimit).toHaveBeenCalledWith("chat:bob", limits);
    expect(isBanned).not.toHaveBeenCalled();
  });

  it("should refuse a listed IP", async () => {
    vi.mocked(isDeniedRequest).mockReturnValueOnce(true);

    await expect(admit("chat", "192.0.2.1", "bob", limits)).resolves.toEqual({
      reason: "denied",
    });
    expect(rateLimit).not.toHaveBeenCalled();
  });

  it("should refuse a banned network", async () => {
    vi.mocked(isBanned).mockResolvedValueOnce(true);

    await expect(admit("chat", "192.0.2.1", "bob", limits)).resolves.toEqual({
      reason: "banned",
    });
  });

  it("should refuse and log a network over its limit", async () => {
    vi.mocked(rateLimit).mockResolvedValueOnce({
      success: false,
      retryAfterSeconds: 42,
    });

    await expect(admit("chat", undefined, "bob", limits)).resolves.toEqual({
      reason: "limited",
      retryAfterSeconds: 42,
    });
    expect(log.info).toHaveBeenCalledWith(
      { action: "chat", subject: "bob", retryAfterSeconds: 42 },
      "Rate limited",
    );
  });
});
