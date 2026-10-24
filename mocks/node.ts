import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

if (process.env.NODE_ENV !== "test") {
  throw new Error("@/mocks/node should only be imported in test environment");
}

// The chat input fetches emoji shortcodes on focus and pings while a message is typed, so every chat test would hit them.
export const server = setupServer(
  http.get("*/api/emoji", () => HttpResponse.json([])),
  http.post("*/api/chat/typing", () => new HttpResponse(null, { status: 204 })),
);
