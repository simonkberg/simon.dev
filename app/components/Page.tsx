import type { PropsWithChildren, ReactNode } from "react";

import { Header } from "@/components/Header";
import { VariantSwitcher } from "@/components/VariantSwitcher";
import { config } from "@/config";

interface PageProps extends PropsWithChildren {
  section?: string;
  footnote?: ReactNode;
}

export const Page = ({ section, footnote, children }: PageProps) => (
  <div className="page">
    <Header section={section} />
    <div className="content">
      {children}
      <footer className="footer">
        {footnote}
        <VariantSwitcher />
        <div className="colophon">
          <span>{new URL(config.url).host}</span>
          <span aria-hidden="true">{config.title}(1)</span>
        </div>
      </footer>
    </div>
  </div>
);
