import { describe, expect, it, vi } from "vitest";

vi.mock(import("next/server"), () => ({ connection: vi.fn() }));

import { GET } from "./route";

describe("GET /health", () => {
  it("should return 200 OK", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("OK");
  });
});
