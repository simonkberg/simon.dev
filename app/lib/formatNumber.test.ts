import { describe, expect, it } from "vitest";

import { formatNumber, formatPlays } from "./formatNumber";

describe("formatNumber", () => {
  it.each([
    [29362, undefined, "29,362"],
    [1234.5, 2, "1,234.50"],
  ])("formats %d with %s decimals as %s", (value, decimals, text) => {
    expect(formatNumber(value, decimals)).toBe(text);
  });
});

describe("formatPlays", () => {
  it.each([
    [1, "1 play"],
    [1234, "1,234 plays"],
  ])("formats %d as %s", (count, text) => {
    expect(formatPlays(count)).toBe(text);
  });

  it("keeps the count's unit while showing a smaller number", () => {
    expect(formatPlays(12, 1)).toBe("1 plays");
  });
});
