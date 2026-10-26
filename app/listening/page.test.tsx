import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ListeningPage, { metadata } from "./page";

vi.mock(
  import("@/listening/components/ListeningPeriod"),
  async (importOriginal) => ({
    ...(await importOriginal()),
    ListeningPeriod: vi.fn(({ period }) => <p>{period}</p>),
  }),
);

describe("ListeningPage", () => {
  it("shows all time", () => {
    render(<ListeningPage />);

    expect(metadata).toMatchObject({ title: "Listening - all time" });
    expect(screen.getByText("overall")).toBeInTheDocument();
  });
});
