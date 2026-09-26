import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { config } from "@/config";

import { Page } from "./Page";

describe("Page", () => {
  it("renders Header with config title", () => {
    render(
      <Page>
        <div>Page content</div>
      </Page>,
    );

    const heading = screen.getByRole("heading", { level: 1 });
    const link = within(heading).getByRole("link");

    expect(link).toHaveTextContent(config.title);
    expect(link).toHaveAttribute("href", "/");
  });

  it("renders Header with section", () => {
    render(
      <Page section="Listening">
        <div>Page content</div>
      </Page>,
    );

    expect(screen.getByRole("link", { name: "listening" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("renders children content", () => {
    render(
      <Page>
        <div>Page content</div>
      </Page>,
    );

    expect(screen.getByText("Page content")).toBeInTheDocument();
  });

  it("renders the hosting note and both switches in the footer", () => {
    render(
      <Page>
        <div>Page content</div>
      </Page>,
    );

    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByRole("link", { name: "Railway" })).toBeVisible();
    expect(within(footer).getByRole("group", { name: "style" })).toBeVisible();
    expect(within(footer).getByRole("group", { name: "theme" })).toBeVisible();
  });
});
