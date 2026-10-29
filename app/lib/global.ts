// Next bundles instrumentation.ts and each route handler into separate module
// graphs, so a module-level `let` is one instance per graph, not per process.
const PREFIX = "simon.dev/";

export function getGlobal<T>(key: string, init: () => T): T {
  const symbol = Symbol.for(PREFIX + key);
  if (!Reflect.has(globalThis, symbol)) {
    Reflect.set(globalThis, symbol, init());
  }
  return Reflect.get(globalThis, symbol) as T;
}

/** Runs `tick` now and again each time after the delay it resolves to, once per process. */
export function repeat(key: string, tick: () => Promise<number>): void {
  getGlobal(key, () => {
    const run = () => {
      void tick().then((delayMs) => setTimeout(run, delayMs).unref());
    };
    run();
    return true;
  });
}

/** @internal Every test starts without the state `getGlobal` keeps. */
export function resetGlobals(): void {
  for (const symbol of Object.getOwnPropertySymbols(globalThis)) {
    if (Symbol.keyFor(symbol)?.startsWith(PREFIX)) {
      Reflect.deleteProperty(globalThis, symbol);
    }
  }
}
