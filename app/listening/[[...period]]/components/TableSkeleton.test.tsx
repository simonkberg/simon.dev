import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TableSkeleton } from "./TableSkeleton";

const head = (
  <thead>
    <tr>
      <th>Head</th>
    </tr>
  </thead>
);

describe("TableSkeleton", () => {
  it("announces loading without exposing the placeholder table", () => {
    render(<TableSkeleton head={head} textColumns={1} />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it.each([1, 2] as const)(
    "renders ten ranked rows with %i text column(s) under the given head",
    (textColumns) => {
      const { container } = render(
        <TableSkeleton head={head} textColumns={textColumns} />,
      );

      expect(container.querySelector("th")).toHaveTextContent("Head");
      const rows = container.querySelectorAll("tbody tr");
      expect(rows).toHaveLength(10);
      expect(rows[9]?.querySelector("td")).toHaveTextContent("10");
      expect(rows[0]?.querySelectorAll("td")).toHaveLength(textColumns + 2);
    },
  );
});
