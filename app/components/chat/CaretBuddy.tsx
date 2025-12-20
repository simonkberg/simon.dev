"use client";

const EXPRESSIONS = {
  idle: "(-_-)zzZ",
  typing: "(°▽°)",
  thinking: "(・・?)",
  code: "(⌐■_■)",
  long: "(°o°)",
  error: "(╥_╥)",
  success: "(＾▽＾)",
} as const;

type BuddyState = keyof typeof EXPRESSIONS;

interface CaretBuddyProps {
  state: BuddyState;
}

export const CaretBuddy = ({ state }: CaretBuddyProps) => {
  return (
    <span className="caret-buddy" aria-hidden="true">
      {EXPRESSIONS[state]}
    </span>
  );
};

export type { BuddyState };
