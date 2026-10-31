import { useReducer } from "react";

import { useTimeout } from "@/components/useTimeout";

type AnimationFrame = readonly [durationSeconds: number, expression: string];
export type AnimationFrames = readonly [AnimationFrame, ...AnimationFrame[]];

export const ANIMATIONS = {
  idle: [
    // Z wave
    [0.5, "(-_-)zzz"],
    [0.4, "(-_-)Zzz"],
    [0.4, "(-_-)zZz"],
    [0.4, "(-_-)zzZ"],
    [0.5, "(-_-)zzz"],
    // Inhale
    [0.4, "(-_-)..."],
    [0.4, "(-o-)..."],
    [0.5, "(-O-)..."],
    // Exhale
    [0.4, "(-o-)..."],
    [0.4, "(-_-)..."],
  ],
  typing: [
    [0.9, "(•▽•)"],
    [1.2, "(≧▽≦)"],
    [0.8, "(•▽•)"],
    [0.15, "(•_•)"],
  ],
  thinking: [
    [1.1, "(• •?)"],
    [0.9, "(•.•?)"],
    [1.0, "(• •?)"],
    [0.15, "(•_•)"],
  ],
  code: [
    [1.4, "(⌐■_■)"],
    [1.2, "(■_■⌐)"],
    [1.3, "(⌐■_■)"],
    [0.15, "( ■_■)"],
  ],
  love: [
    [1.2, "♥(◡‿◡)"],
    [0.15, "♡(◕‿◕)"],
    [0.15, "♥(◡‿◡)"],
    [0.4, "♡(◕‿◕)"],
  ],
  long: [
    [0.9, "(•o•)"],
    [0.8, "(•O•)"],
    [1.1, "(•o•)"],
    [0.15, "(•_•)"],
  ],
  error: [
    [1.0, "(╥_╥)"],
    [0.15, "(╥⌢╥)"],
  ],
  success: [
    [1.0, "(^ᵥ^)"],
    [0.15, "(^_^)"],
  ],
} as const satisfies Record<string, AnimationFrames>;

interface Animation {
  frames: AnimationFrames;
  index: number;
  frame: AnimationFrame;
}

type AnimationAction =
  | { type: "play"; frames: AnimationFrames }
  | { type: "advance" };

function animation(state: Animation, action: AnimationAction): Animation {
  switch (action.type) {
    case "play":
      return { frames: action.frames, index: 0, frame: action.frames[0] };
    case "advance": {
      const index = state.index + 1;
      const frame = state.frames[index];
      return frame
        ? { ...state, index, frame }
        : { ...state, index: 0, frame: state.frames[0] };
    }
  }
}

export function useFrameAnimation(frames: AnimationFrames): string {
  const [state, dispatch] = useReducer(animation, {
    frames,
    index: 0,
    frame: frames[0],
  });
  if (frames !== state.frames) dispatch({ type: "play", frames });
  const [duration, expression] = state.frame;

  useTimeout(() => dispatch({ type: "advance" }), duration * 1000, state);

  return expression;
}
