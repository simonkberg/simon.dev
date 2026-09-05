import { connection } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getPendingStages } from "@/lib/readiness";

import { GET } from "./route";

vi.mock(import("next/server"), () => ({ connection: vi.fn() }));
vi.mock(import("@/lib/readiness"), () => ({ getPendingStages: vi.fn() }));

describe("GET /health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 200 OK once every stage is ready", async () => {
    vi.mocked(getPendingStages).mockReturnValue([]);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("OK");
    expect(connection).toHaveBeenCalledOnce();
  });

  it("should return 503 with the pending stages while starting", async () => {
    vi.mocked(getPendingStages).mockReturnValue(["bot"]);

    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: "starting",
      pending: ["bot"],
    });
  });
});
