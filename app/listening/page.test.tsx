import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  generateListeningMetadata,
  type ListeningPageContentProps,
} from "./components/ListeningPageContent";
import ListeningPage, { metadata } from "./page";

vi.mock("server-only", () => ({}));

vi.mock(import("./components/ListeningPageContent"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    ListeningPageContent: ({ period }: ListeningPageContentProps) => (
      <div data-testid="listening-page-content">{period}</div>
    ),
  };
});

describe("ListeningPage", () => {
  it("should export metadata for overall period", () => {
    expect(metadata).toEqual(generateListeningMetadata("overall"));
  });

  it("should render ListeningPageContent with overall period", () => {
    render(<ListeningPage />);

    const content = screen.getByTestId("listening-page-content");
    expect(content).toHaveTextContent("overall");
  });
});
