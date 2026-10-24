"use client";

import {
  type ComponentProps,
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import {
  type EmojiShortcodes,
  REACTION_EMOJI,
  searchEmoji,
  withSkinTone,
} from "@/lib/emoji";

import { arrowIndex, gridColumns } from "./arrowFocus";
import { ChatCommandSuggestions } from "./ChatCommandSuggestions";
import { ChatEmojiSuggestions } from "./ChatEmojiSuggestions";
import { typedCommand } from "./commands";
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
  return query === undefined
    ? null
    : ({
        kind: "emoji",
        query,
        start: caret - query.length - 1,
        end: caret,
      } as const);
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
  const [emoji, setEmoji] = useState<EmojiShortcodes[] | null>(null);
  // Tagged with the value it was typed in, so a reset by the form forgets it.
  const [typed, setTyped] = useState<
    | (NonNullable<ReturnType<typeof typedAt>> & {
        value: string;
        dismissed: boolean;
      })
    | null
  >(null);
  if (typed && typed.value !== value) setTyped(null);
  const shown = typed && !typed.dismissed ? typed : null;

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

  const [active, setActive] = useState<number | null>(null);
  const key = shown && `${shown.kind}:${shown.query}`;
  const [previousKey, setPreviousKey] = useState(key);
  if (key !== previousKey) {
    setPreviousKey(key);
    setActive(shown ? initialActive() : null);
  }

  // A short query may be an emoticon like ":D", and a command typed in full needs nothing
  // picked, so Enter only picks once one is chosen.
  function initialActive() {
    if (shown?.kind === "emoji") return shown.query.length >= 2 ? 0 : null;
    const complete = commandMatches.some(
      (match) => match.final && match.value === shown?.query,
    );
    return complete ? null : 0;
  }

  const open = picks.length > 0;
  const chosen = active === null ? undefined : picks[active];

  useEffect(() => {
    const input = ref.current;
    if (open && input) list.current?.showPopover({ source: input });
  }, [open, ref, shown?.kind]);

  // A dismissal holds only for the command or shortcode it closed on.
  function track(input: HTMLInputElement) {
    const next = typedAt(input);
    const current = input.value;
    // Focus can come before hydration, leaving onFocus unheard.
    if (next?.kind === "emoji" && !emoji) void loadShortcodes().then(setEmoji);
    setTyped((previous) => {
      if (!next) return null;
      // Unchanged on a caret move, so React can skip the render.
      if (
        previous?.kind === next.kind &&
        previous.query === next.query &&
        previous.value === current
      )
        return previous;
      return { ...next, value: current, dismissed: false };
    });
  }

  function dismiss() {
    setTyped((previous) => previous && { ...previous, dismissed: true });
  }

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
      setActive(0);
      return;
    }
    const columns =
      shown?.kind === "emoji"
        ? gridColumns([...listbox.querySelectorAll("button")])
        : undefined;
    const next = arrowIndex(event, active, picks.length - 1, columns);
    if (next === undefined) return;
    event.preventDefault();
    if (picks[next] !== undefined) setActive(next);
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
        onFocus={() => void reloadShortcodes().then(setEmoji)}
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
          <ChatCommandSuggestions
            ref={list}
            id={id}
            matches={commandMatches}
            active={active}
            onPick={pick}
            onDismiss={dismiss}
          />
        ) : (
          <ChatEmojiSuggestions
            ref={list}
            id={id}
            matches={emojiMatches}
            active={active}
            onPick={pick}
            onDismiss={dismiss}
          />
        ))}
    </>
  );
};
