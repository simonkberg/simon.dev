import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Hydrated } from "./Hydrated";

describe("Hydrated", () => {
  it("marks <html> once it has rendered", () => {
    render(<Hydrated />);

    expect(document.documentElement).toHaveAttribute("data-hydrated");
  });
});
