import { describe, expect, it } from "vitest";

import Default from "./default";

describe("Default", () => {
  it("shows no days off a day's page", () => {
    expect(Default()).toBeNull();
  });
});
