import "@testing-library/jest-dom/vitest";
import { Globals } from "@react-spring/web";
import { cleanup, configure } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";

import { resetGlobals } from "@/lib/global";
import { log } from "@/lib/log";
import { server } from "@/mocks/node";

configure({ reactStrictMode: true });

// happy-dom has no popover API: these mark an open popover with an attribute tests can query.
if (
  "HTMLElement" in globalThis &&
  typeof HTMLElement.prototype.showPopover !== "function"
) {
  const setOpen = (element: HTMLElement, open: boolean) => {
    if (!element.hasAttribute("popover")) {
      throw new DOMException("Not a popover", "NotSupportedError");
    }
    element.toggleAttribute("data-popover-open", open);
  };
  HTMLElement.prototype.showPopover = function () {
    setOpen(this, true);
  };
  HTMLElement.prototype.hidePopover = function () {
    setOpen(this, false);
  };
}

vi.mock(import("server-only"), () => ({}));

beforeAll(() => {
  server.listen({ onUnhandledFrame: "error" });
});

beforeEach(() => {
  resetGlobals();
  Globals.assign({ skipAnimation: true });
  // Tests assert on log calls through vi.mocked(log.<level>); none should print.
  for (const level of [
    "fatal",
    "error",
    "warn",
    "info",
    "debug",
    "trace",
  ] as const) {
    vi.spyOn(log, level).mockImplementation(() => {});
  }
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  if (typeof window !== "undefined") {
    // Left by preferences and the commands that set them.
    const root = document.documentElement;
    for (const name of root.getAttributeNames()) root.removeAttribute(name);
    for (const cookie of document.cookie.split("; ").filter(Boolean)) {
      document.cookie = `${cookie.split("=")[0]}=; max-age=0; path=/`;
    }
    document.head.replaceChildren();
    // Cleared the way another tab would, so stores that cache it start over.
    localStorage.clear();
    window.dispatchEvent(new StorageEvent("storage"));
  }
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});
