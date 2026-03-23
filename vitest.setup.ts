import "@testing-library/jest-dom/vitest";

// Polyfill Promise.try for Node < 24
if (typeof Promise.try !== "function") {
  // @ts-expect-error -- polyfill for older Node versions
  Promise.try = function <T>(fn: () => T | PromiseLike<T>): Promise<T> {
    return new Promise<T>((resolve) => resolve(fn()));
  };
}

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
