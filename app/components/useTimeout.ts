import { useEffect, useEffectEvent } from "react";

/** Calls `callback` once `ms` passes, waiting again whenever `ms` or `restart` changes; no `ms`, no wait. */
export function useTimeout(
  callback: () => void,
  ms: number | undefined,
  restart?: unknown,
) {
  const fire = useEffectEvent(callback);

  useEffect(() => {
    if (ms === undefined) return;
    const timer = setTimeout(() => fire(), ms);
    return () => clearTimeout(timer);
  }, [ms, restart]);
}
