// Next bundles instrumentation.ts and each route handler into separate module
// graphs, so a module-level `let` is one instance per graph, not per process.
export function getGlobal<T>(key: string, init: () => T): T {
  const symbol = Symbol.for(key);
  if (!Reflect.has(globalThis, symbol)) {
    Reflect.set(globalThis, symbol, init());
  }
  return Reflect.get(globalThis, symbol) as T;
}

export function resetGlobal(key: string): void {
  Reflect.deleteProperty(globalThis, Symbol.for(key));
}
