import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  generateListeningMetadata,
  type ListeningPageContentProps,
} from "../components/ListeningPageContent";
import Listening6MonthPage, { metadata } from "./page";

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

describe("Listening6MonthPage", () => {
  it("should export metadata for 6month period", () => {
    expect(metadata).toEqual(generateListeningMetadata("6month"));
  });

  it("should render ListeningPageContent with 6month period", () => {
    render(<Listening6MonthPage />);

    const content = screen.getByTestId("listening-page-content");
    expect(content).toHaveTextContent("6month");
  });
});
