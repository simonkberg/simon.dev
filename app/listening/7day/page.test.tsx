import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  generateListeningMetadata,
  type ListeningPageContentProps,
} from "../components/ListeningPageContent";
import Listening7DayPage, { metadata } from "./page";

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

describe("Listening7DayPage", () => {
  it("should export metadata for 7day period", () => {
    expect(metadata).toEqual(generateListeningMetadata("7day"));
  });

  it("should render ListeningPageContent with 7day period", () => {
    render(<Listening7DayPage />);

    const content = screen.getByTestId("listening-page-content");
    expect(content).toHaveTextContent("7day");
  });
});
