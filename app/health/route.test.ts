import { connection } from "next/server";
import { describe, expect, it, vi } from "vitest";

import { GET } from "./route";

vi.mock(import("next/server"), () => ({ connection: vi.fn() }));

describe("GET /health", () => {
  it("should return 200 OK", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("OK");
    expect(connection).toHaveBeenCalledOnce();
  });
});
