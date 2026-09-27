import type { CSSProperties, PropsWithChildren } from "react";

export interface SkeletonProps {
  width: `${number}ch`;
}

export const Skeleton = ({ width }: SkeletonProps) => (
  <span className="skeleton" style={{ "--width": width } as CSSProperties} />
);

// A sibling rather than a wrapper, so the placeholder sits where its content will.
export const SkeletonStatus = ({ children }: PropsWithChildren) => (
  <>
    <span role="status" className="visually-hidden">
      Loading
    </span>
    {children}
  </>
);
