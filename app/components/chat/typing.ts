import { useSyncExternalStore } from "react";

const NOBODY: readonly string[] = [];
const listeners = new Set<() => void>();
let current = NOBODY;

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/** Who is typing, as the chat stream last said. */
export const useTyping = () =>
  useSyncExternalStore(
    subscribe,
    () => current,
    () => NOBODY,
  );

export function setTyping(typing: readonly string[]) {
  current = typing.length > 0 ? typing : NOBODY;
  for (const listener of listeners) listener();
}
