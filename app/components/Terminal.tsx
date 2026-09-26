"use client";

import { type PropsWithChildren, useRef } from "react";

export const Terminal = ({ children }: PropsWithChildren) => {
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
