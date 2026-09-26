import "@testing-library/jest-dom/vitest";
import { Globals } from "@react-spring/web";
import { cleanup, configure } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, vi } from "vitest";

import { mockRouter } from "@/mocks/navigation";
import { server } from "@/mocks/node";

// Page renders the preference switches, which refresh the router.
vi.mock(import("next/navigation"), async (importOriginal) => ({
  ...(await importOriginal()),
  useRouter: () => mockRouter,
}));

Globals.assign({ skipAnimation: true });
configure({ reactStrictMode: true });

beforeAll(() => {
  server.listen();
});

afterEach(() => {
  cleanup();
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});
