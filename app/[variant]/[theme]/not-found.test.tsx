import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { config } from "@/config";

import NotFound from "./not-found";

describe("NotFound", () => {
  it("should set the title", () => {
    render(<NotFound />);

    expect(document.title).toBe(`Not Found - ${config.title}`);
  });

  it("should display 'Page not found!' heading", () => {
    render(<NotFound />);

    expect(
      screen.getByRole("heading", { name: "Page not found!", level: 2 }),
    ).toBeInTheDocument();
  });
});
