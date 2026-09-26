import { act, render, screen } from "@testing-library/react";
import { theme, variant } from "next/root-params";
import type { PropsWithChildren } from "react";
import { describe, expect, it, vi } from "vitest";

import type { SavedPreferences } from "@/components/Preferences";
import { config } from "@/config";

import RootLayout, { generateStaticParams, metadata } from "./layout";

// `use()` needs the same promise on each render, as the real getters give.
const saved = {
  variant: Promise.resolve("ledger"),
  theme: Promise.resolve("dark"),
};

vi.mock(import("next/root-params"), () => ({
  variant: vi.fn(() => saved.variant),
  theme: vi.fn(() => saved.theme),
}));

vi.mock(import("@/components/Layout"), () => ({
  Layout: ({
    children,
    variant,
    theme,
  }: PropsWithChildren<Partial<SavedPreferences>>) => (
    <div data-testid="layout" data-variant={variant} data-theme={theme}>
      {children}
    </div>
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

describe("generateStaticParams", () => {
  it("should prerender every variant with every theme", () => {
    const params = generateStaticParams();

    expect(params).toHaveLength(9);
    expect(params).toContainEqual({ variant: "manual", theme: "light" });
  });
});

describe("RootLayout", () => {
  it("should render children within Layout", async () => {
    await act(async () => render(<RootLayout>Test Content</RootLayout>));

    expect(screen.getByTestId("layout")).toHaveTextContent("Test Content");
  });

  it("should pass the root params to Layout", async () => {
    await act(async () => render(<RootLayout>{null}</RootLayout>));

    expect(screen.getByTestId("layout")).toHaveAttribute(
      "data-variant",
      "ledger",
    );
    expect(screen.getByTestId("layout")).toHaveAttribute("data-theme", "dark");
  });

  it("should 404 for unknown root params", async () => {
    const [api, nope] = [Promise.resolve("api"), Promise.resolve("nope")];
    vi.mocked(variant).mockImplementation(() => api);
    vi.mocked(theme).mockImplementation(() => nope);

    await expect(
      act(async () => render(<RootLayout>{null}</RootLayout>)),
    ).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
  });
});
