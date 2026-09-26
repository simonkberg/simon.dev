import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Layout } from "@/components/Layout";
import { config } from "@/config";

vi.mock(import("@/assets/fonts"), () => ({
  iosevka: {
    className: "iosevka-mock-class",
    style: { fontFamily: "Iosevka" },
  },
}));

describe("Layout", () => {
  it("should render children content", () => {
    render(<Layout>Test Content</Layout>, { container: document });

    expect(screen.getByText("Test Content")).toBeInTheDocument();
  });

  it("should set lang attribute to en on html element", () => {
    render(<Layout />, { container: document });

    expect(document.documentElement).toHaveAttribute("lang", "en");
  });

  it("should apply font class to html element", () => {
    render(<Layout />, { container: document });

    expect(document.documentElement).toHaveClass("iosevka-mock-class");
  });

  it("should default to the panes variant and the system theme", () => {
    render(<Layout />, { container: document });

    expect(document.documentElement).toHaveAttribute("data-variant", "panes");
    expect(document.documentElement).toHaveAttribute("data-theme", "system");
  });

  it("should render the given preferences", () => {
    render(<Layout variant="manual" theme="dark" />, { container: document });

    expect(document.documentElement).toHaveAttribute("data-variant", "manual");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });

  it("should include Google Tag Manager with correct ID", async () => {
    render(<Layout />, { container: document });

    expect(
      document.body.querySelector("script[id=_next-gtm-init]"),
    ).toBeInTheDocument();
    expect(document.body.querySelector("script[id=_next-gtm]")).toHaveAttribute(
      "src",
      `https://www.googletagmanager.com/gtm.js?id=${config.gtmId}`,
    );
  });
});
