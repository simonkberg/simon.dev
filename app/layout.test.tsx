import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { config } from "@/config";

import RootLayout, { metadata, viewport } from "./layout";

vi.mock(import("@/components/Layout"), () => import("@/mocks/layout"));

describe("metadata", () => {
  it("should have the title template, description, canonical URL and large share cards", () => {
    expect(metadata).toEqual({
      metadataBase: new URL(config.url),
      title: { default: config.title, template: `%s - ${config.title}` },
      description: config.description,
      alternates: { canonical: new URL(config.url) },
      twitter: { card: "summary_large_image" },
    });
  });
});

describe("viewport", () => {
  it("covers the safe areas", () => {
    expect(viewport).toEqual({ viewportFit: "cover" });
  });
});

describe("RootLayout", () => {
  it("renders children inside Layout", () => {
    render(<RootLayout>Test Content</RootLayout>);

    expect(
      within(screen.getByTestId("layout")).getByText("Test Content"),
    ).toBeInTheDocument();
  });
});
