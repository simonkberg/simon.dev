import type { ReactNode } from "react";

import { Skeleton, SkeletonStatus } from "@/components/Skeleton";

const textWidths = [
  [16, 11],
  [10, 14],
  [21, 8],
  [13, 12],
  [8, 16],
  [18, 10],
  [12, 7],
  [15, 13],
  [9, 11],
  [19, 9],
] as const;

export interface TableSkeletonProps {
  head: ReactNode;
  textColumns: 1 | 2;
}

export const TableSkeleton = ({ head, textColumns }: TableSkeletonProps) => (
  <SkeletonStatus>
    <table className="placeholder" aria-hidden="true">
      {head}
      <tbody>
        {textWidths.map((widths, index) => (
          <tr key={index}>
            <td className="numeric">{index + 1}</td>
            {widths.slice(0, textColumns).map((width, column) => (
              <td key={column}>
                <Skeleton width={`${width}ch`} />
              </td>
            ))}
            <td className="numeric">
              <Skeleton width="4ch" />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </SkeletonStatus>
);
