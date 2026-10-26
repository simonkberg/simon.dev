import Link from "next/link";

import { config } from "@/config";

export interface HeaderProps {
  section?: string;
}

export const Header = ({ section = "home" }: HeaderProps) => (
  <header className="header">
    <div className="container">
      <h1 className="title">
        <Link href="/" className="link">
          {config.title}
        </Link>
      </h1>
      <nav className="nav" aria-label="Pages">
        {config.pages.map(({ href, name }) => (
          <Link
            key={href}
            href={href}
            aria-current={name === section.toLowerCase() ? "page" : undefined}
          >
            {name}
          </Link>
        ))}
      </nav>
      <span className="host">{new URL(config.url).host}</span>
    </div>
  </header>
);
