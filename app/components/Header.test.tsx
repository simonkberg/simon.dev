import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { config } from "@/config";

import { Header } from "./Header";

const pages = () => screen.getByRole("navigation", { name: "Pages" });

describe("Header", () => {
  it("renders the title as a link to the homepage", () => {
    render(<Header />);

    const heading = screen.getByRole("heading", { level: 1 });
    const link = within(heading).getByRole("link");
    expect(link).toHaveTextContent(config.title);
    expect(link).toHaveAttribute("href", "/");
  });

  it("links every page", () => {
    render(<Header />);

    expect(within(pages()).getByRole("link", { name: "home" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(
      within(pages()).getByRole("link", { name: "listening" }),
    ).toHaveAttribute("href", "/listening");
  });

  it("marks home as the current page without a section", () => {
    render(<Header />);

    expect(within(pages()).getByRole("link", { name: "home" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      within(pages()).getByRole("link", { name: "listening" }),
    ).not.toHaveAttribute("aria-current");
  });

  it("marks the section's page as current", () => {
    render(<Header section="Listening" />);

    expect(
      within(pages()).getByRole("link", { name: "listening" }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      within(pages()).getByRole("link", { name: "home" }),
    ).not.toHaveAttribute("aria-current");
  });

  it("marks no page as current on other sections", () => {
    render(<Header section="Not Found" />);

    for (const link of within(pages()).getAllByRole("link")) {
      expect(link).not.toHaveAttribute("aria-current");
    }
  });

  it("shows the site's host", () => {
    render(<Header />);

    expect(screen.getByText("simon.dev")).toBeInTheDocument();
  });
});
