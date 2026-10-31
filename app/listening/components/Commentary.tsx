"use client";

import { Suspense, use, useEffect, useReducer } from "react";
import { z } from "zod";

import {
  ANIMATIONS,
  type AnimationFrames,
  useFrameAnimation,
} from "@/components/faces";
import { Heading } from "@/components/Heading";
import { Subtitle } from "@/components/Subtitle";
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
  | { phase: "done"; text: string }
  | { phase: "none" };

type Action =
  | { type: "stored"; text: string | undefined }
  | { type: "written"; text: string | undefined; instant: boolean }
  | { type: "tick" }
  | { type: "fail" };

function reduce(state: State, action: Action): State {
  switch (action.type) {
    case "stored":
      return action.text === undefined
        ? { phase: "waiting" }
        : { phase: "done", text: action.text };
    case "written":
      if (action.text === undefined) return { phase: "none" };
      return action.instant
        ? { phase: "done", text: action.text }
        : { phase: "typing", text: action.text, shown: 0 };
    case "tick": {
      if (state.phase !== "typing") return state;
      const shown = state.shown + CHARACTERS_PER_TICK;
      return shown < state.text.length
        ? { ...state, shown }
        : { phase: "done", text: state.text };
    }
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
    if (signal.aborted) return reject(signal.reason);
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

const framesOf = (state: State) =>
  state.phase === "waiting"
    ? ANIMATIONS.thinking
    : state.phase === "typing"
      ? ANIMATIONS.typing
      : RESTING;

function Words({ state }: { state: State }) {
  switch (state.phase) {
    case "asking":
      return null;
    case "waiting":
      return (
        <span className="quiet">
          listening back
          <span className="caret" />
        </span>
      );
    case "typing":
      return (
        <span>
          {state.text.slice(0, state.shown)}
          <span className="caret" />
        </span>
      );
    case "done":
      return <span>{state.text}</span>;
    case "none":
      return <span className="quiet">nothing to say this time</span>;
  }
}

function Pane({ state }: { state: State }) {
  const face = useFrameAnimation(framesOf(state));
  return (
    <p
      className="commentary"
      aria-busy={state.phase !== "done" && state.phase !== "none"}
    >
      <span className="face" aria-hidden="true">
        {face}
      </span>
      <Words state={state} />
    </p>
  );
}

const initialState = (stored: string | undefined | null): State =>
  stored === null
    ? { phase: "asking" }
    : stored === undefined
      ? { phase: "waiting" }
      : { phase: "done", text: stored };

function Take({
  page,
  stored,
}: {
  page: string;
  stored: Promise<string | undefined | null> | undefined;
}) {
  // Null when the page couldn't look it up, so the browser asks.
  const known = stored === undefined ? null : use(stored);
  const [state, dispatch] = useReducer(reduce, known, initialState);

  useEffect(() => {
    if (known !== undefined && known !== null) return;
    const controller = new AbortController();
    const { signal } = controller;
    void (async () => {
      try {
        if (known === null) {
          const found = await ask(page, "GET", signal);
          dispatch({ type: "stored", text: found });
          if (found !== undefined) return;
        }
        await sleep(WAIT_MS, signal);
        const written = await ask(page, "POST", signal);
        const instant = matchMedia("(prefers-reduced-motion: reduce)").matches;
        dispatch({ type: "written", text: written, instant });
      } catch {
        if (!signal.aborted) dispatch({ type: "fail" });
      }
    })();
    return () => controller.abort();
  }, [page, known]);

  useTimeout(
    () => dispatch({ type: "tick" }),
    state.phase === "typing" ? TICK_MS : undefined,
    state.phase === "typing" ? state.shown : undefined,
  );

  return <Pane state={state} />;
}

/**
 * simon-bot's take on a page, in a pane of its own, written on the first visit that finds none.
 * A page that can look up the stored take passes it, so it renders with the page.
 */
export function Commentary({
  page,
  stored,
}: {
  page: string;
  stored?: Promise<string | undefined | null>;
}) {
  // The pane is there from the first paint, with room for a take, so little moves when one arrives.
  return (
    <section>
      <Heading level={2}>
        simon-bot <Subtitle>(take)</Subtitle>
      </Heading>
      <Suspense fallback={<Pane state={{ phase: "asking" }} />}>
        <Take page={page} stored={stored} />
      </Suspense>
    </section>
  );
}
