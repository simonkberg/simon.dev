import Link from "next/link";

import { config } from "@/config";

export interface HeaderProps {
  section?: string;
}

const toPath = (section: string) => section.toLowerCase().replaceAll(" ", "-");

export const Header = ({ section }: HeaderProps) => (
  <header className="header">
    <div className="container">
      <h1 className="title">
        <Link href="/" className="link">
          {config.title}
        </Link>
        {section && <span className="path">{toPath(section)}</span>}
      </h1>
      <nav className="windows" aria-label="Pages">
        <Link href="/" aria-current={section ? undefined : "page"}>
          0:home
        </Link>
        <Link
          href="/listening/"
          aria-current={section === "Listening" ? "page" : undefined}
        >
          1:listening
        </Link>
      </nav>
      <span className="status">stockholm, se</span>
    </div>
  </header>
);
