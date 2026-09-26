import { describe, expect, it } from "vitest";

import Missing from "./page";

describe("Missing", () => {
  it("should render the 404 page", () => {
    expect(() => Missing()).toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
  });
});
