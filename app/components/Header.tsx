import Link from "next/link";

import { config } from "@/config";
import { route } from "@/lib/routes";

export interface HeaderProps {
  section?: string;
}

const toPath = (section: string) => section.toLowerCase().replaceAll(" ", "-");

const windows = [
  { href: route("/"), path: "home" },
  { href: route("/listening/"), path: "listening" },
] as const;

export const Header = ({ section }: HeaderProps) => (
  <header className="header">
    <div className="container">
      <h1 className="title">
        <Link href={route("/")} className="link">
          {config.title}
        </Link>
        {section && <span className="path">{toPath(section)}</span>}
      </h1>
      <nav className="windows" aria-label="Pages">
        {windows.map(({ href, path }, index) => (
          <Link
            key={href}
            href={href}
            aria-current={
              path === toPath(section ?? "home") ? "page" : undefined
            }
          >
            {index}:{path}
          </Link>
        ))}
      </nav>
      <span className="status">stockholm, se</span>
    </div>
  </header>
);
