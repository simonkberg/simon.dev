import { describe, expect, it } from "vitest";

import MonthDaysDay from "./page";

describe("MonthDaysDay", () => {
  it("adds nothing to its month's days", () => {
    expect(MonthDaysDay()).toBeNull();
  });
});
