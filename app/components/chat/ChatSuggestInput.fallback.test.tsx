import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { expect, it, vi } from "vitest";

import { renderChatInput } from "@/mocks/chatInput";
import { server } from "@/mocks/node";

vi.mock(import("@/actions/chat"), () => ({ postChatMessage: vi.fn() }));

// A file of its own, since the fetched set is kept for the page's lifetime.
it("falls back to the reactions when the emoji can't load, and retries on the next focus", async () => {
  server.use(
    http.get("*/api/emoji", () =>
      HttpResponse.json({ error: "Bad gateway" }, { status: 502 }),
    ),
  );
  const { user, input } = renderChatInput();

  await user.type(input, ":sku");
  expect(await screen.findByRole("option", { name: "skull" })).toBeVisible();

  server.use(
    http.get("*/api/emoji", () =>
      HttpResponse.json([["☠️", ["skull_crossbones"], []]]),
    ),
  );
  await user.click(screen.getByRole("button", { name: "Next" }));
  await user.click(input);
  await user.keyboard("l");

  expect(
    await screen.findByRole("option", { name: "skull_crossbones" }),
  ).toBeVisible();
});
