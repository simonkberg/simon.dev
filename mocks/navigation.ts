import type { useRouter } from "next/navigation";
import { vi } from "vitest";

export const refresh = vi.fn();

/** The router `useRouter()` returns in tests, registered in `vitest.setup.ts`. */
export const mockRouter: ReturnType<typeof useRouter> = {
  back: vi.fn(),
  forward: vi.fn(),
  refresh,
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
  bfcacheId: "test",
};
