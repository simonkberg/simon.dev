"use client";

import {
  type ComponentProps,
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useId,
  useReducer,
  useRef,
} from "react";

import {
  type EmojiShortcodes,
  REACTION_EMOJI,
  searchEmoji,
  withSkinTone,
} from "@/lib/emoji";

import { arrowIndex, gridColumns } from "./arrowFocus";
import { ChatSuggestions } from "./ChatSuggestions";
import { typedCommand } from "./commands";
import { EmojiButton } from "./EmojiButton";
import { loadShortcodes, reloadShortcodes } from "./shortcodes";
import { useSkinTone } from "./skinTone";

const LIMIT = 24;

const SHORTCODE = /(?:^|\s):([\w+-]*)$/;

/** The command or shortcode typed up to the caret, and the range a pick replaces. */
function typedAt(input: HTMLInputElement) {
  const caret = input.selectionStart;
  if (caret === null || caret !== input.selectionEnd) return null;
  const before = input.value.slice(0, caret);
  const command = typedCommand(before);
  if (command) return { kind: "command", ...command, end: caret } as const;
  const query = SHORTCODE.exec(before)?.[1];
  if (query === undefined) return null;
  const start = caret - query.length - 1;
  return { kind: "emoji", query, start, end: caret } as const;
}

type Typed = NonNullable<ReturnType<typeof typedAt>>;

interface Suggesting {
  // Tagged with the value it was typed in, so a reset by the form forgets it.
  typed: (Typed & { value: string; dismissed: boolean }) | null;
  active: number | null;
}

type SuggestingAction =
  | { type: "track"; typed: Typed | null; value: string }
  | { type: "dismiss" | "forget" }
  | { type: "choose"; index: number };

// A short query may be an emoticon like ":D", and a command typed in full needs nothing
// picked, so Enter only picks once one is chosen.
function initialActive(typed: Typed) {
  if (typed.kind === "emoji") return typed.query.length >= 2 ? 0 : null;
  return typed.complete ? null : 0;
}

const shownOf = (typed: Suggesting["typed"]) =>
  typed && !typed.dismissed ? typed : null;

// With where it starts, so a picked command's options start over.
const shownKey = (typed: Suggesting["typed"]) => {
  const shown = shownOf(typed);
  return shown && `${shown.kind}:${shown.start}:${shown.query}`;
};

function retype(state: Suggesting, typed: Suggesting["typed"]): Suggesting {
  if (shownKey(typed) === shownKey(state.typed)) return { ...state, typed };
  const shown = shownOf(typed);
  return { typed, active: shown && initialActive(shown) };
}

// A dismissal holds only for the command or shortcode it closed on.
function suggesting(state: Suggesting, action: SuggestingAction): Suggesting {
  const { typed } = state;
  switch (action.type) {
    case "track": {
      const next = action.typed;
      if (!next) return typed ? retype(state, null) : state;
      // Unchanged on a caret move, so React can skip the render.
      if (
        typed?.kind === next.kind &&
        typed.query === next.query &&
        typed.value === action.value
      )
        return state;
      return retype(state, { ...next, value: action.value, dismissed: false });
    }
    case "dismiss":
      return retype(state, typed && { ...typed, dismissed: true });
    case "forget":
      return retype(state, null);
    case "choose":
      return { ...state, active: action.index };
  }
}

/** A text input that suggests commands after a leading slash, and emoji for the shortcode typed up to its caret. */
export const ChatSuggestInput = ({
  ref,
  value,
  onValueChange,
  ...props
}: Omit<
  ComponentProps<"input">,
  "ref" | "value" | "onChange" | "onSelect" | "onKeyDown" | "onBlur" | "onFocus"
> & {
  ref: RefObject<HTMLInputElement | null>;
  value: string;
  onValueChange: (value: string) => void;
}) => {
  const id = useId();
  const list = useRef<HTMLDivElement>(null);
  const [emoji, loaded] = useReducer(
    (_: EmojiShortcodes[] | null, list: EmojiShortcodes[]) => list,
    null,
  );
  const [{ typed, active }, dispatch] = useReducer(suggesting, {
    typed: null,
    active: null,
  });
  if (typed && typed.value !== value) dispatch({ type: "forget" });
  const shown = shownOf(typed);

  const { modifier } = useSkinTone();
  const emojiMatches = (
    shown?.kind !== "emoji" || !emoji
      ? []
      : shown.query
        ? searchEmoji(emoji, shown.query, LIMIT)
        : REACTION_EMOJI
  ).map((match) => ({ ...match, emoji: withSkinTone(match.emoji, modifier) }));
  const commandMatches = shown?.kind === "command" ? shown.suggestions : [];
  const picks =
    shown?.kind === "command"
      ? commandMatches.map((match) => match.value)
      : emojiMatches.map((match) => match.emoji);

  const open = picks.length > 0;
  const chosen = active === null ? undefined : picks[active];
  const chosenEmoji = active === null ? undefined : emojiMatches[active];

  useEffect(() => {
    const input = ref.current;
    if (open && input) list.current?.showPopover({ source: input });
  }, [open, ref, shown?.kind]);

  function track(input: HTMLInputElement) {
    const next = typedAt(input);
    // Focus can come before hydration, leaving onFocus unheard.
    if (next?.kind === "emoji" && !emoji) void loadShortcodes().then(loaded);
    dispatch({ type: "track", typed: next, value: input.value });
  }

  const dismiss = () => dispatch({ type: "dismiss" });

  function pick(text: string) {
    const input = ref.current;
    const range = input && typedAt(input);
    if (!input || !range) return;
    const spaced = /^\s/.test(input.value.slice(range.end));
    input.setRangeText(
      spaced ? text : `${text} `,
      range.start,
      range.end,
      "end",
    );
    // A picked command opens its options.
    track(input);
    onValueChange(input.value);
    input.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const listbox = list.current;
    if (!open || !listbox || event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      dismiss();
      return;
    }
    if (
      chosen &&
      (event.key === "Enter" || (event.key === "Tab" && !event.shiftKey))
    ) {
      event.preventDefault();
      pick(chosen);
      return;
    }
    // Home and End stay with the caret; until one is chosen, left and right do too.
    if (event.key === "Home" || event.key === "End") return;
    if (active === null) {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault();
      dispatch({ type: "choose", index: 0 });
      return;
    }
    const columns =
      shown?.kind === "emoji"
        ? gridColumns([...listbox.querySelectorAll("button")])
        : undefined;
    const next = arrowIndex(event, active, picks.length - 1, columns);
    if (next === undefined) return;
    event.preventDefault();
    if (picks[next] !== undefined) dispatch({ type: "choose", index: next });
  }

  return (
    <>
      <input
        {...props}
        ref={ref}
        value={value}
        onChange={(event) => {
          onValueChange(event.target.value);
          track(event.target);
        }}
        onSelect={(event) => track(event.currentTarget)}
        onFocus={() => void reloadShortcodes().then(loaded)}
        onKeyDown={onKeyDown}
        onBlur={(event) => {
          // Null when a tap on an emoji takes focus; its click picks it.
          if (
            open &&
            event.relatedTarget &&
            !list.current?.contains(event.relatedTarget)
          ) {
            dismiss();
          }
        }}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={id}
        aria-activedescendant={chosen ? `${id}-${active}` : undefined}
      />
      {open &&
        (shown?.kind === "command" ? (
          <ChatSuggestions
            ref={list}
            id={id}
            label="Commands"
            className="command-picker"
            matches={commandMatches}
            active={active}
            onDismiss={dismiss}
            option={({ value, label, detail }, props) => (
              <button key={value} {...props} onClick={() => pick(value)}>
                <span className="label">{label}</span>
                {detail && <span className="detail">{detail}</span>}
              </button>
            )}
          />
        ) : (
          <ChatSuggestions
            ref={list}
            id={id}
            label="Emoji"
            className="emoji-picker"
            matches={emojiMatches}
            active={active}
            onDismiss={dismiss}
            option={({ emoji, name }, props) => (
              <EmojiButton
                key={emoji}
                {...props}
                emoji={emoji}
                name={name}
                picker={id}
                onClick={() => pick(emoji)}
              />
            )}
          >
            <p className="name" aria-hidden="true">
              {chosenEmoji && `:${chosenEmoji.name}:`}
            </p>
          </ChatSuggestions>
        ))}
    </>
  );
};
