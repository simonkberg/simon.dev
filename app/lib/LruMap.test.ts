import { describe, expect, it } from "vitest";

import { LruMap } from "./LruMap";

describe("LruMap", () => {
  it("sets and gets values", () => {
    const cache = new LruMap<string, number>(3);
    cache.set("a", 1);

    expect(cache.get("a")).toBe(1);
  });

  it("returns undefined for non-existent keys", () => {
    const cache = new LruMap<string, number>(3);

    expect(cache.get("missing")).toBeUndefined();
  });

  it("updates existing values", () => {
    const cache = new LruMap<string, number>(3);
    cache.set("a", 1);
    cache.set("a", 2);

    expect(cache.get("a")).toBe(2);
    expect(cache.size).toBe(1);
  });

  it("evicts least recently used item when capacity is exceeded", () => {
    const cache = new LruMap<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);

    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
    expect(cache.size).toBe(2);
  });

  it("moves accessed items to most recently used", () => {
    const cache = new LruMap<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a"); // Access "a" to make it most recently used
    cache.set("c", 3);

    expect(cache.get("a")).toBe(1);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBe(3);
  });

  it("moves updated items to most recently used", () => {
    const cache = new LruMap<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("a", 10); // Update "a" to make it most recently used
    cache.set("c", 3);

    expect(cache.get("a")).toBe(10);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBe(3);
  });

  it("checks if key exists with has()", () => {
    const cache = new LruMap<string, number>(3);
    cache.set("a", 1);

    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
  });

  it("deletes items", () => {
    const cache = new LruMap<string, number>(3);
    cache.set("a", 1);
    cache.set("b", 2);

    expect(cache.delete("a")).toBe(true);
    expect(cache.has("a")).toBe(false);
    expect(cache.size).toBe(1);
  });

  it("returns false when deleting non-existent key", () => {
    const cache = new LruMap<string, number>(3);

    expect(cache.delete("missing")).toBe(false);
  });

  it("clears all items", () => {
    const cache = new LruMap<string, number>(3);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.clear();

    expect(cache.size).toBe(0);
    expect(cache.has("a")).toBe(false);
    expect(cache.has("b")).toBe(false);
  });

  it("iterates over keys in LRU order", () => {
    const cache = new LruMap<string, number>(3);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);

    expect([...cache.keys()]).toEqual(["a", "b", "c"]);
  });

  it("iterates over values in LRU order", () => {
    const cache = new LruMap<string, number>(3);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);

    expect([...cache.values()]).toEqual([1, 2, 3]);
  });

  it("iterates over entries in LRU order", () => {
    const cache = new LruMap<string, number>(3);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);

    expect([...cache.entries()]).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
  });

  it("supports forEach iteration", () => {
    const cache = new LruMap<string, number>(3);
    cache.set("a", 1);
    cache.set("b", 2);

    const entries: [string, number][] = [];
    cache.forEach((value, key) => {
      entries.push([key, value]);
    });

    expect(entries).toEqual([
      ["a", 1],
      ["b", 2],
    ]);
  });

  it("supports for...of iteration", () => {
    const cache = new LruMap<string, number>(3);
    cache.set("a", 1);
    cache.set("b", 2);

    const entries: [string, number][] = [];
    for (const entry of cache) {
      entries.push(entry);
    }

    expect(entries).toEqual([
      ["a", 1],
      ["b", 2],
    ]);
  });

  it("has correct toStringTag", () => {
    const cache = new LruMap<string, number>(3);

    expect(cache[Symbol.toStringTag]).toBe("LruMap");
  });

  it("handles single item cache", () => {
    const cache = new LruMap<string, number>(1);
    cache.set("a", 1);
    cache.set("b", 2);

    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.size).toBe(1);
  });

  it("getOrInsert returns existing value without modifying cache", () => {
    const cache = new LruMap<string, number>(3);
    cache.set("a", 1);

    expect(cache.getOrInsert("a", 99)).toBe(1);
    expect(cache.get("a")).toBe(1);
    expect(cache.size).toBe(1);
  });

  it("getOrInsert inserts default value for missing key", () => {
    const cache = new LruMap<string, number>(3);

    expect(cache.getOrInsert("a", 42)).toBe(42);
    expect(cache.get("a")).toBe(42);
    expect(cache.size).toBe(1);
  });

  it("getOrInsert respects LRU eviction", () => {
    const cache = new LruMap<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.getOrInsert("c", 3);

    expect(cache.has("a")).toBe(false);
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
  });

  it("getOrInsert moves existing key to most recently used", () => {
    const cache = new LruMap<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.getOrInsert("a", 99); // Access "a", should become MRU
    cache.set("c", 3);

    expect(cache.get("a")).toBe(1);
    expect(cache.has("b")).toBe(false);
  });

  it("getOrInsertComputed returns existing value without calling callback", () => {
    const cache = new LruMap<string, number>(3);
    cache.set("a", 1);

    let called = false;
    const result = cache.getOrInsertComputed("a", () => {
      called = true;
      return 99;
    });

    expect(result).toBe(1);
    expect(called).toBe(false);
  });

  it("getOrInsertComputed computes and inserts value for missing key", () => {
    const cache = new LruMap<string, number>(3);

    const result = cache.getOrInsertComputed("a", (key) => key.length);

    expect(result).toBe(1);
    expect(cache.get("a")).toBe(1);
    expect(cache.size).toBe(1);
  });

  it("getOrInsertComputed respects LRU eviction", () => {
    const cache = new LruMap<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.getOrInsertComputed("c", () => 3);

    expect(cache.has("a")).toBe(false);
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
  });

  it("getOrInsertComputed moves existing key to most recently used", () => {
    const cache = new LruMap<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.getOrInsertComputed("a", () => 99); // Access "a", should become MRU
    cache.set("c", 3);

    expect(cache.get("a")).toBe(1);
    expect(cache.has("b")).toBe(false);
  });

  it("deletes the tail node", () => {
    const cache = new LruMap<string, number>(3);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);

    expect(cache.delete("c")).toBe(true); // Delete tail
    expect(cache.has("c")).toBe(false);
    expect(cache.size).toBe(2);
    expect([...cache.keys()]).toEqual(["a", "b"]);
  });

  it("deletes from single-item cache", () => {
    const cache = new LruMap<string, number>(3);
    cache.set("a", 1);

    expect(cache.delete("a")).toBe(true);
    expect(cache.size).toBe(0);
    expect(cache.has("a")).toBe(false);
  });
});
