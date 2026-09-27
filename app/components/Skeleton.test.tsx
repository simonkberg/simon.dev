import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Skeleton } from "./Skeleton";

describe("Skeleton", () => {
  it("sets its width", () => {
    const { container } = render(<Skeleton width={12} />);

    expect(
      container
        .querySelector<HTMLElement>(".skeleton")
        ?.style.getPropertyValue("--width"),
    ).toBe("12ch");
  });
});
