import type { PropsWithChildren } from "react";

export interface SubtitleProps extends PropsWithChildren {
  className?: string;
}

export const Subtitle = ({ className, children }: SubtitleProps) => (
  <small className={className ? `subtitle ${className}` : "subtitle"}>
    {children}
  </small>
);
