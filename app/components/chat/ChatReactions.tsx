"use client";

import {
  createContext,
  type KeyboardEvent,
  type ToggleEvent,
  use,
  useId,
  useReducer,
  useRef,
} from "react";

import { TooltipButton, WhenShown } from "@/components/Tooltip";
import type { Reaction } from "@/lib/discord/api";
import {
  REACTION_EMOJI,
  SKIN_TONES,
  withoutSkinTone,
  withSkinTone,
} from "@/lib/emoji";

import { arrowFocus, arrowIndex, gridColumns } from "./arrowFocus";
import { EmojiButton } from "./EmojiButton";
import { EmojiShortcode } from "./EmojiText";
import { getSkinTone, setSkinTone, useSkinTone } from "./skinTone";

export interface ChatReactionsContextValue {
  reacting: ReadonlySet<string>;
  react: (messageId: string, emoji: string) => void;
}

export const ChatReactionsContext = createContext<ChatReactionsContextValue>({
  reacting: new Set(),
  react: () => {},
});

const HAND = "✋";

// One function for every option, so it runs once as the row opens, not when the tone changes.
const focusPressed = (button: HTMLButtonElement | null) => {
  if (button?.getAttribute("aria-pressed") === "true") button.focus();
};

const SkinTonePicker = ({ picker }: { picker: string }) => {
  const tone = useSkinTone();
  const [choosing, dispatch] = useReducer(
    (choosing: boolean, action: "toggle" | "close") =>
      action === "toggle" && !choosing,
    false,
  );
  const toggle = useRef<HTMLButtonElement>(null);

  return (
    <div className="skin-tones" role="group" aria-label="Skin tone">
      {choosing &&
        SKIN_TONES.map((option) => (
          <TooltipButton
            key={option.name}
            ref={focusPressed}
            tooltip={option.name}
            anchor={picker}
            aria-pressed={option === tone}
            onClick={() => {
              setSkinTone(option);
              dispatch("close");
              toggle.current?.focus();
            }}
          >
            {withSkinTone(HAND, option.modifier)}
          </TooltipButton>
        ))}
      <TooltipButton
        ref={toggle}
        tooltip={`Skin tone: ${tone.name}`}
        anchor={picker}
        aria-expanded={choosing}
        onClick={() => dispatch("toggle")}
      >
        {withSkinTone(HAND, tone.modifier)}
      </TooltipButton>
    </div>
  );
};

const ReactionEmoji = ({
  messageId,
  reactions,
  picker,
}: {
  messageId: string;
  reactions: Reaction[];
  picker: string;
}) => {
  const { react } = use(ChatReactionsContext);
  const { modifier } = useSkinTone();

  return REACTION_EMOJI.map(({ emoji, name }) => {
    const toned = withSkinTone(emoji, modifier);
    return (
      <EmojiButton
        key={name}
        emoji={toned}
        name={name}
        picker={picker}
        popoverTarget={picker}
        popoverTargetAction="hide"
        // Only adds: the pill takes it back, and another tone replaces yours.
        onClick={() => {
          if (!reactions.some((r) => r.mine && r.emoji === toned)) {
            react(messageId, toned);
          }
        }}
      />
    );
  });
};

export const ChatReactionPicker = ({
  messageId,
  reactions,
  glyph = "☺",
}: {
  messageId: string;
  reactions: Reaction[];
  glyph?: string;
}) => {
  const { reacting } = use(ChatReactionsContext);
  const pickerId = useId();
  // Rendered only while open: a hundred messages would otherwise hold thousands of buttons.
  const [state, toggled] = useReducer(
    (_: "open" | "closed", next: "open" | "closed") => next,
    "closed",
  );
  const trigger = useRef<HTMLButtonElement>(null);

  const toggle = (event: ToggleEvent<HTMLDivElement>) => {
    toggled(event.newState === "open" ? "open" : "closed");
    // The emoji unmount as it closes, which would otherwise leave focus on the page.
    if (
      event.newState !== "closed" ||
      !event.currentTarget.contains(document.activeElement)
    ) {
      return;
    }
    const button = trigger.current;
    // A pick disables the button before the picker closes.
    (button?.disabled
      ? button.closest<HTMLElement>(".chat-message")
      : button
    )?.focus();
  };

  const focusFirst = (event: ToggleEvent<HTMLDivElement>) => {
    if (event.newState === "open") {
      event.currentTarget.querySelector("button")?.focus();
    }
  };

  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    const picker = event.currentTarget;
    if (event.key === "Escape") {
      // Prevented, so the input's Escape doesn't also cancel a reply.
      event.preventDefault();
      picker.hidePopover();
      return;
    }
    if (event.key === "Tab") {
      // Closing moves focus to the button, so Tab moves on past it and Shift+Tab lands on it.
      picker.hidePopover();
      if (event.shiftKey) event.preventDefault();
      return;
    }
    const grid = [
      ...picker.querySelectorAll<HTMLButtonElement>(":scope > button"),
    ];
    const tones = [
      ...picker.querySelectorAll<HTMLButtonElement>(".skin-tones > button"),
    ];
    const columns = gridColumns(grid);
    const current = grid.findIndex((button) => button === event.target);
    // The tone row sits under the grid, its toggle under the last emoji.
    const below =
      event.key === "ArrowDown" &&
      (arrowIndex(event, current, grid.length - 1, columns) ?? -1) >=
        grid.length;
    const above =
      event.key === "ArrowUp" &&
      tones.some((button) => button === event.target);
    const across = below ? tones.at(-1) : above ? grid.at(-1) : undefined;
    if (across) {
      event.preventDefault();
      across.focus();
      return;
    }
    // Also at its edges, where the key would scroll the chat behind the picker.
    if (
      arrowFocus(event, grid, columns) ||
      arrowFocus(event, tones, tones.length)
    )
      event.preventDefault();
  };

  return (
    <>
      <TooltipButton
        ref={trigger}
        tooltip="Add reaction"
        className="react"
        popoverTarget={pickerId}
        disabled={reacting.has(messageId)}
      >
        {glyph}
      </TooltipButton>
      <div
        id={pickerId}
        popover="auto"
        role="toolbar"
        aria-label="Pick a reaction"
        tabIndex={-1}
        className="chat-reaction-picker emoji-picker"
        onBeforeToggle={toggle}
        onToggle={focusFirst}
        onKeyDown={navigate}
      >
        {state === "open" && (
          <>
            <ReactionEmoji
              messageId={messageId}
              reactions={reactions}
              picker={pickerId}
            />
            <SkinTonePicker picker={pickerId} />
          </>
        )}
      </div>
    </>
  );
};

export const nameList = new Intl.ListFormat("en", { type: "conjunction" });

const toneOrder = (emoji: string) =>
  SKIN_TONES.findLastIndex(({ modifier }) => emoji.includes(modifier));

/** Reactions by emoji, each tone of one as a variant, as Slack shows them. */
function groupByEmoji(reactions: Reaction[]): Map<string, Reaction[]> {
  const groups = Map.groupBy(reactions, ({ emoji }) => withoutSkinTone(emoji));
  for (const variants of groups.values()) {
    variants.sort((a, b) => toneOrder(a.emoji) - toneOrder(b.emoji));
  }
  return groups;
}

function describeReactors(variants: Reaction[], count: number): string {
  const users = variants.flatMap((variant) => variant.users);
  const mine = variants.filter((variant) => variant.mine).length;
  const named = new Set(mine > 0 ? ["you", ...users] : users);
  const onDiscord = count - users.length - mine;
  return nameList.format(
    onDiscord > 0 ? [...named, `${onDiscord} on Discord`] : named,
  );
}

export const ChatReactionList = ({
  messageId,
  reactions,
}: {
  messageId: string;
  reactions: Reaction[];
}) => {
  const { reacting, react } = use(ChatReactionsContext);

  return (
    <div className="reactions" role="group" aria-label="Reactions">
      {[...groupByEmoji(reactions)].map(([base, variants]) => {
        const count = variants.reduce((sum, variant) => sum + variant.count, 0);
        const own = variants.find((variant) => variant.mine);
        return (
          <TooltipButton
            key={base}
            // Discord's wording; the shortcode waits for the tooltip, so rendering pills fetches nothing.
            tooltip={
              <>
                <WhenShown>
                  <EmojiShortcode emoji={base} />{" "}
                </WhenShown>
                reacted by {describeReactors(variants, count)}
              </>
            }
            describes
            aria-pressed={own !== undefined}
            disabled={reacting.has(messageId)}
            // Takes back the visitor's own in any tone, else adds theirs.
            onClick={() =>
              react(
                messageId,
                own?.emoji ?? withSkinTone(base, getSkinTone().modifier),
              )
            }
          >
            {variants.map((variant) => variant.emoji).join("")}{" "}
            <span className="count">{count}</span>
          </TooltipButton>
        );
      })}
      <ChatReactionPicker
        messageId={messageId}
        reactions={reactions}
        glyph="+"
      />
    </div>
  );
};
