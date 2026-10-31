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
import type { GetCommentaryResult } from "@/lib/commentary";

// Skips a day only glanced at on the way to another.
const WAIT_MS = 1000;
const TICK_MS = 30;
const CHARACTERS_PER_TICK = 2;
const RESTING: AnimationFrames = [
  [4, "(°ᴗ°)"],
  [0.12, "(-ᴗ-)"],
  [0.15, "(°ᴗ°)"],
  [0.12, "(-ᴗ-)"],
];

type State =
  | { phase: "pending" }
  | { phase: "typing"; text: string; shown: number }
  | { phase: "done"; text: string }
  | { phase: "early" }
  | { phase: "none" };

type Action =
  | { type: "stored"; text: string | undefined }
  | { type: "written"; text: string | undefined; instant: boolean }
  | { type: "tick" }
  | { type: "early" }
  | { type: "fail" };

function reduce(state: State, action: Action): State {
  switch (action.type) {
    case "stored":
      return action.text === undefined
        ? { phase: "pending" }
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
    case "early":
      return { phase: "early" };
    case "fail":
      return { phase: "none" };
  }
}

// A day still taking plays has no take yet.
class TooEarly extends Error {}

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
  if (response.status === 404) throw new TooEarly();
  if (!response.ok) throw new Error(`Commentary answered ${response.status}`);
  return responseSchema.parse(await response.json()).text;
}

const framesOf = (state: State) =>
  state.phase === "pending"
    ? ANIMATIONS.thinking
    : state.phase === "typing"
      ? ANIMATIONS.typing
      : RESTING;

function Words({ state }: { state: State }) {
  switch (state.phase) {
    // Looked up or written, the wait reads the same, so a miss streaming in changes nothing.
    case "pending":
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
    case "early":
      return <span className="quiet">ask me once the day is over</span>;
    case "none":
      return <span className="quiet">nothing to say this time</span>;
  }
}

function Pane({ state }: { state: State }) {
  const face = useFrameAnimation(framesOf(state));
  return (
    <p
      className="commentary"
      aria-busy={state.phase === "pending" || state.phase === "typing"}
    >
      <span className="face" aria-hidden="true">
        {face}
      </span>
      <Words state={state} />
    </p>
  );
}

function initialState(stored: GetCommentaryResult | undefined): State {
  if (stored?.status === "early") return { phase: "early" };
  if (stored?.status === "ok" && stored.text !== undefined) {
    return { phase: "done", text: stored.text };
  }
  return { phase: "pending" };
}

function Take({
  page,
  stored,
}: {
  page: string;
  stored: Promise<GetCommentaryResult> | undefined;
}) {
  const result = stored && use(stored);
  const [state, dispatch] = useReducer(reduce, result, initialState);
  // Looked up by the browser when the page couldn't.
  const lookUp = result === undefined || result.status === "error";
  // A page left and come back to keeps its state but reruns effects: only a take still pending asks.
  const pending = state.phase === "pending";

  useEffect(() => {
    if (!pending) return;
    const controller = new AbortController();
    const { signal } = controller;
    void (async () => {
      try {
        if (lookUp) {
          const found = await ask(page, "GET", signal);
          dispatch({ type: "stored", text: found });
          if (found !== undefined) return;
        }
        await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
        // Aborted by then, the request is too, and the catch drops it.
        const written = await ask(page, "POST", signal);
        const instant = matchMedia("(prefers-reduced-motion: reduce)").matches;
        dispatch({ type: "written", text: written, instant });
      } catch (err) {
        if (signal.aborted) return;
        dispatch({ type: err instanceof TooEarly ? "early" : "fail" });
      }
    })();
    return () => controller.abort();
  }, [page, lookUp, pending]);

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
  stored?: Promise<GetCommentaryResult>;
}) {
  return (
    <section>
      <Heading level={2}>
        simon-bot <Subtitle>(take)</Subtitle>
      </Heading>
      <Suspense fallback={<Pane state={{ phase: "pending" }} />}>
        <Take page={page} stored={stored} />
      </Suspense>
    </section>
  );
}
