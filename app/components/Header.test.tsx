import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { config } from "@/config";

import { Header } from "./Header";

describe("Header", () => {
  it("renders the title as a link to the homepage", () => {
    render(<Header />);

    const heading = screen.getByRole("heading", { level: 1 });
    const link = within(heading).getByRole("link");
    expect(link).toHaveTextContent(config.title);
    expect(link).toHaveAttribute("href", "/");
  });

  it("renders the section as a path", () => {
    render(<Header section="Not Found" />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      `${config.title}not-found`,
    );
  });

  it("marks home as the current page without a section", () => {
    render(<Header />);

    const nav = screen.getByRole("navigation", { name: "Pages" });
    expect(within(nav).getByRole("link", { name: "0:home" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      within(nav).getByRole("link", { name: "1:listening" }),
    ).not.toHaveAttribute("aria-current");
  });

  it("marks listening as the current page", () => {
    render(<Header section="Listening" />);

    const nav = screen.getByRole("navigation", { name: "Pages" });
    expect(
      within(nav).getByRole("link", { name: "1:listening" }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      within(nav).getByRole("link", { name: "0:home" }),
    ).not.toHaveAttribute("aria-current");
  });

  it("marks no page as current on other sections", () => {
    render(<Header section="Error" />);

    const nav = screen.getByRole("navigation", { name: "Pages" });
    for (const link of within(nav).getAllByRole("link")) {
      expect(link).not.toHaveAttribute("aria-current");
    }
  });
});
