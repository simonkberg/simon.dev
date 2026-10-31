import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

if (process.env.NODE_ENV !== "test") {
  throw new Error("@/mocks/node should only be imported in test environment");
}

// The chat input fetches emoji shortcodes on focus and pings while a message is typed, and listening pages ask for
// simon-bot's commentary, so every chat and listening test would hit them.
export const server = setupServer(
  http.get("*/api/emoji", () => HttpResponse.json([])),
  http.get("*/api/commentary", () => new HttpResponse(null, { status: 404 })),
  http.post("*/api/chat/typing", () => new HttpResponse(null, { status: 204 })),
);
