import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Day } from "@/lib/dates";

import {
  TravelContext,
  TravelPending,
  type TravelPendingProps,
} from "./Travel";

// Oct 14, 2012's page, travelling to `target`.
const renderPending = (of: TravelPendingProps["of"], target: Day) =>
  render(
    <TravelContext
      value={{
        date: "2012-10-14",
        target,
        travel: vi.fn(),
        scrub: vi.fn(),
        release: vi.fn(),
        going: undefined,
      }}
    >
      <TravelPending of={of}>
        <p>Shown</p>
      </TravelPending>
    </TravelContext>,
  ).container.firstElementChild;

describe("TravelPending", () => {
  it.each([
    ["day", "2012-10-02", true],
    ["month", "2012-10-02", false],
    ["month", "2008-02-14", true],
  ] as const)("of the %s, travelling to %s, dims: %s", (of, target, dims) => {
    expect(renderPending(of, target)?.hasAttribute("data-pending")).toBe(dims);
  });
});
