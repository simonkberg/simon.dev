import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Skeleton, SkeletonStatus } from "./Skeleton";

describe("SkeletonStatus", () => {
  it("announces loading and hides the placeholder from assistive tech", () => {
    render(
      <SkeletonStatus>
        <ul aria-hidden="true">
          <li>
            <Skeleton width="4ch" />
          </li>
        </ul>
      </SkeletonStatus>,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});

describe("Skeleton", () => {
  it("sets its width", () => {
    const { container } = render(<Skeleton width="12ch" />);

    expect(
      container
        .querySelector<HTMLElement>(".skeleton")
        ?.style.getPropertyValue("--width"),
    ).toBe("12ch");
  });
});
