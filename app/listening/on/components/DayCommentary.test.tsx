import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DayCommentary } from "./DayCommentary";
import { TravelContext } from "./Travel";

vi.mock(import("@/listening/components/Commentary"), () => ({
  Commentary: ({ page }: { page: string }) => <p>comment on {page}</p>,
}));

describe("DayCommentary", () => {
  it("should comment on the day travelled to", () => {
    render(
      <TravelContext
        value={{
          date: "2019-03-04",
          target: undefined,
          going: undefined,
          travel: vi.fn(),
          scrub: vi.fn(),
          release: vi.fn(),
          cancel: vi.fn(),
        }}
      >
        <DayCommentary />
      </TravelContext>,
    );

    expect(screen.getByText("comment on 2019-03-04")).toBeInTheDocument();
  });

  it("should comment on nothing before a day is picked", () => {
    const { container } = render(<DayCommentary />);

    expect(container).toBeEmptyDOMElement();
  });
});
