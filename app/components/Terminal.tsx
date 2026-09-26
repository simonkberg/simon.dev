"use client";

import { type PropsWithChildren, type ReactNode, useRef } from "react";

export interface TerminalProps extends PropsWithChildren {
  status?: ReactNode;
}

export const Terminal = ({ status, children }: TerminalProps) => {
  const terminalRef = useRef<HTMLDivElement>(null);

  const handleClickMaximize = () => {
    if (!terminalRef.current) return;

    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void terminalRef.current.requestFullscreen();
    }
  };

  return (
    <div
      className="terminal"
      ref={terminalRef}
      role="region"
      aria-label="Terminal"
    >
      <div className="topbar">
        {status}
        <button
          className="control maximize"
          aria-label="Maximize"
          onClick={handleClickMaximize}
        />
      </div>
      <div className="content">{children}</div>
    </div>
  );
};
