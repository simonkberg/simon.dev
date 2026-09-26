import { render, screen } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { describe, expect, it, vi } from "vitest";

import { config } from "@/config";

import RootLayout, { metadata } from "./layout";

vi.mock(import("@/components/Layout"), () => ({
  Layout: ({ children }: PropsWithChildren) => (
    <div data-testid="layout">{children}</div>
  ),
}));

describe("metadata", () => {
  it("should have correct title with template", () => {
    expect(metadata.title).toEqual({
      default: config.title,
      template: `%s - ${config.title}`,
    });
  });

  it("should have correct description", () => {
    expect(metadata.description).toEqual(config.description);
  });

  it("should have correct alternates", () => {
    expect(metadata.alternates).toEqual({ canonical: new URL(config.url) });
  });
});

describe("RootLayout", () => {
  it("should render within Layout component", () => {
    render(<RootLayout>Test Content</RootLayout>);

    expect(screen.getByTestId("layout")).toBeInTheDocument();
  });

  it("should render children", () => {
    render(<RootLayout>Test Content</RootLayout>);

    expect(screen.getByText("Test Content")).toBeInTheDocument();
  });
});
