"use client";

import { type KeyboardEvent, useEffect, useId, useReducer } from "react";
import { z } from "zod";

import {
  ANIMATIONS,
  type AnimationFrames,
  useFrameAnimation,
} from "@/components/chat/CaretBuddy";
import { useTimeout } from "@/components/useTimeout";

// Long enough that stepping through days doesn't have each one written.
const WAIT_MS = 2000;
const TICK_MS = 30;
const CHARACTERS_PER_TICK = 2;
const RESTING: AnimationFrames = [[60, "(°ᴗ°)"]];

type State =
  | { phase: "asking" }
  | { phase: "waiting" }
  | { phase: "typing"; text: string; shown: number }
  | { phase: "done"; text: string; open: boolean }
  | { phase: "none" };

type Action =
  | { type: "stored"; text: string | undefined }
  | { type: "written"; text: string | undefined; instant: boolean }
  | { type: "tick" }
  | { type: "toggle" }
  | { type: "fail" };

function reduce(state: State, action: Action): State {
  switch (action.type) {
    case "stored":
      return action.text === undefined
        ? { phase: "waiting" }
        : { phase: "done", text: action.text, open: false };
    case "written":
      if (action.text === undefined) return { phase: "none" };
      return action.instant
        ? { phase: "done", text: action.text, open: true }
        : { phase: "typing", text: action.text, shown: 0 };
    case "tick": {
      if (state.phase !== "typing") return state;
      const shown = state.shown + CHARACTERS_PER_TICK;
      return shown < state.text.length
        ? { ...state, shown }
        : { phase: "done", text: state.text, open: true };
    }
    case "toggle":
      return state.phase === "done" ? { ...state, open: !state.open } : state;
    case "fail":
      return { phase: "none" };
  }
}

const responseSchema = z.object({ text: z.string() });

async function ask(
  page: string,
  method: "GET" | "POST",
  signal: AbortSignal,
): Promise<string | undefined> {
  const response = await fetch(
    `/api/commentary?page=${encodeURIComponent(page)}`,
    { method, signal },
  );
  if (response.status === 204) return undefined;
  if (!response.ok) throw new Error(`Commentary answered ${response.status}`);
  return responseSchema.parse(await response.json()).text;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

const framesOf = (state: State) =>
  state.phase === "waiting"
    ? ANIMATIONS.thinking
    : state.phase === "typing"
      ? ANIMATIONS.typing
      : RESTING;

/** simon-bot's comment in the corner of a page's first pane, written on the first visit that finds none. */
export function Commentary({ page }: { page: string }) {
  const [state, dispatch] = useReducer(reduce, { phase: "asking" });
  const face = useFrameAnimation(framesOf(state));
  const bubble = useId();

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    void (async () => {
      try {
        const stored = await ask(page, "GET", signal);
        dispatch({ type: "stored", text: stored });
        if (stored !== undefined) return;
        await sleep(WAIT_MS, signal);
        const written = await ask(page, "POST", signal);
        const instant = matchMedia("(prefers-reduced-motion: reduce)").matches;
        dispatch({ type: "written", text: written, instant });
      } catch {
        if (!signal.aborted) dispatch({ type: "fail" });
      }
    })();
    return () => controller.abort();
  }, [page]);

  useTimeout(
    () => dispatch({ type: "tick" }),
    state.phase === "typing" ? TICK_MS : undefined,
    state.phase === "typing" ? state.shown : undefined,
  );

  if (state.phase === "asking" || state.phase === "none") return null;

  const open =
    state.phase === "typing" || (state.phase === "done" && state.open);
  const closeOnEscape = (event: KeyboardEvent) => {
    if (event.key === "Escape" && open) dispatch({ type: "toggle" });
  };

  return (
    <div className="commentary">
      <button
        type="button"
        className="tag"
        aria-expanded={open}
        aria-controls={bubble}
        disabled={state.phase !== "done"}
        onClick={() => dispatch({ type: "toggle" })}
        onKeyDown={closeOnEscape}
      >
        <span aria-hidden="true">{face}</span>
        simon-bot
        {state.phase === "waiting" && (
          <span className="hint">
            is listening back
            <span className="caret" />
          </span>
        )}
        {state.phase === "done" && (
          <span className="hint">{open ? "▴" : "has a take ▾"}</span>
        )}
      </button>
      {open && (
        <p id={bubble} className="bubble" aria-busy={state.phase === "typing"}>
          {state.phase === "typing" ? (
            <>
              {state.text.slice(0, state.shown)}
              <span className="caret" />
            </>
          ) : (
            state.text
          )}
        </p>
      )}
    </div>
  );
}
