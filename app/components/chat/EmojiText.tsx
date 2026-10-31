"use client";

import { Suspense } from "react";

import { TooltipText } from "@/components/Tooltip";
import { withoutSkinTone } from "@/lib/emoji";

import { useShortcodes } from "./shortcodes";

const EMOJI = /(\p{RGI_Emoji})/v;

const Shortcode = ({ emoji }: { emoji: string }) => {
  const base = withoutSkinTone(emoji);
  const name = useShortcodes().find(([known]) => known === base)?.[1][0];
  return name && `:${name}:`;
};

/** The emoji's `:shortcode:`, from the set the chat prefetches. */
export const EmojiShortcode = ({ emoji }: { emoji: string }) => (
  <Suspense fallback="…">
    <Shortcode emoji={emoji} />
  </Suspense>
);

/** Text with each emoji naming its shortcode in a tooltip. */
export const EmojiText = ({ text }: { text: string }) =>
  text.split(EMOJI).map((part, index) =>
    index % 2 === 0 ? (
      part
    ) : (
      <TooltipText key={index} tooltip={<EmojiShortcode emoji={part} />}>
        {part}
      </TooltipText>
    ),
  );
