import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  generateListeningMetadata,
  type ListeningPageContentProps,
} from "../components/ListeningPageContent";
import Listening1MonthPage, { metadata } from "./page";

vi.mock("server-only", () => ({}));

vi.mock(
  import("../components/ListeningPageContent"),
  async (importOriginal) => {
    const actual = await importOriginal();
    return {
      ...actual,
      ListeningPageContent: ({ period }: ListeningPageContentProps) => (
        <div data-testid="listening-page-content">{period}</div>
      ),
    };
  },
);

describe("Listening1MonthPage", () => {
  it("should export metadata for 1month period", () => {
    expect(metadata).toEqual(generateListeningMetadata("1month"));
  });

  it("should render ListeningPageContent with 1month period", () => {
    render(<Listening1MonthPage />);

    const content = screen.getByTestId("listening-page-content");
    expect(content).toHaveTextContent("1month");
  });
});
