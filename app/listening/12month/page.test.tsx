import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  generateListeningMetadata,
  type ListeningPageContentProps,
} from "../components/ListeningPageContent";
import Listening12MonthPage, { metadata } from "./page";

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

describe("Listening12MonthPage", () => {
  it("should export metadata for 12month period", () => {
    expect(metadata).toEqual(generateListeningMetadata("12month"));
  });

  it("should render ListeningPageContent with 12month period", () => {
    render(<Listening12MonthPage />);

    const content = screen.getByTestId("listening-page-content");
    expect(content).toHaveTextContent("12month");
  });
});
