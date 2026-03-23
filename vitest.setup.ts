import "@testing-library/jest-dom/vitest";

import { Globals } from "@react-spring/web";
import { cleanup, configure } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";

import { server } from "@/mocks/node";

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
