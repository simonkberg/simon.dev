import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { Skeleton } from "@/components/Skeleton";

export interface FlashbackProps {
  title: ReactNode;
  children: ReactNode;
  href: Route;
  more: string;
}

export const Flashback = ({ title, children, href, more }: FlashbackProps) => (
  <div className="flashback">
    <strong className="flashback-title">{title}</strong>
    <p>
      {children} See&nbsp;<Link href={href}>{more}</Link>.
    </p>
  </div>
);

export const FlashbackSkeleton = ({ titleWidth }: { titleWidth: number }) => (
  <div className="flashback" aria-hidden="true">
    <span className="flashback-title">
      <Skeleton width={titleWidth} />
    </span>
    <p>
      <Skeleton width={36} />
    </p>
  </div>
);
