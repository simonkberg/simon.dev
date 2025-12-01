import { headers } from "next/headers";
import { describe, expect, it, vi } from "vitest";

import { identifiers } from "./identifiers";

vi.mock(import("next/headers"), () => ({ headers: vi.fn() }));

describe("identifiers", () => {
  it("should return IP from x-forwarded-for header", async () => {
    vi.mocked(headers).mockResolvedValue(
      new Headers([["x-forwarded-for", "192.168.1.1"]]),
    );

    const result = await identifiers();

    expect(result.ip).toBe("192.168.1.1");
  });

  it("should return IP from x-real-ip when x-forwarded-for is missing", async () => {
    vi.mocked(headers).mockResolvedValue(
      new Headers([["x-real-ip", "10.0.0.1"]]),
    );

    const result = await identifiers();

    expect(result.ip).toBe("10.0.0.1");
  });

  it("should use first IP when x-forwarded-for contains multiple IPs", async () => {
    vi.mocked(headers).mockResolvedValue(
      new Headers([
        ["x-forwarded-for", "203.0.113.1, 198.51.100.1, 192.0.2.1"],
      ]),
    );

    const result = await identifiers();

    expect(result.ip).toBe("203.0.113.1");
  });

  it("should prefer x-forwarded-for over x-real-ip when both present", async () => {
    vi.mocked(headers).mockResolvedValue(
      new Headers([
        ["x-forwarded-for", "192.168.1.1"],
        ["x-real-ip", "10.0.0.1"],
      ]),
    );

    const result = await identifiers();

    expect(result.ip).toBe("192.168.1.1");
  });

  it("should return user agent from header", async () => {
    vi.mocked(headers).mockResolvedValue(
      new Headers([["user-agent", "Custom User Agent/1.0"]]),
    );

    const result = await identifiers();

    expect(result.userAgent).toBe("Custom User Agent/1.0");
  });

  it("should return undefined when headers are missing", async () => {
    vi.mocked(headers).mockResolvedValue(new Headers());

    const result = await identifiers();

    expect(result.ip).toBeUndefined();
    expect(result.userAgent).toBeUndefined();
  });
});
