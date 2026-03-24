class ListNode<K, V> {
  constructor(
    public key: K,
    public value: V,
    public prev: ListNode<K, V> | null = null,
    public next: ListNode<K, V> | null = null,
  ) {}
}

export class LruMap<K, V> implements Map<K, V> {
  #cache: Map<K, ListNode<K, V>>;
  #maxSize: number;
  #head: ListNode<K, V> | null = null;
  #tail: ListNode<K, V> | null = null;

  constructor(maxSize: number) {
    this.#cache = new Map<K, ListNode<K, V>>();
    this.#maxSize = maxSize;
  }

  get size(): number {
    return this.#cache.size;
  }

  get [Symbol.toStringTag](): string {
    return "LruMap";
  }

  get(key: K): V | undefined {
    const node = this.#cache.get(key);
    if (!node) return undefined;

    // Move to tail (most recently used)
    this.#moveToTail(node);
    return node.value;
  }

  set(key: K, value: V): this {
    const existingNode = this.#cache.get(key);

    if (existingNode) {
      // Update existing node
      existingNode.value = value;
      this.#moveToTail(existingNode);
    } else {
      // Create new node
      const newNode = new ListNode(key, value);
      this.#cache.set(key, newNode);
      this.#addToTail(newNode);

      // Evict least recently used if over capacity
      if (this.#cache.size > this.#maxSize) {
        this.#removeHead();
      }
    }

    return this;
  }

  has(key: K): boolean {
    return this.#cache.has(key);
  }

  delete(key: K): boolean {
    const node = this.#cache.get(key);
    if (!node) return false;

    this.#removeNode(node);
    return this.#cache.delete(key);
  }

  getOrInsert(key: K, defaultValue: V): V {
    const node = this.#cache.get(key);
    if (node) {
      this.#moveToTail(node);
      return node.value;
    }
    this.set(key, defaultValue);
    return defaultValue;
  }

  getOrInsertComputed(key: K, callbackfn: (key: K) => V): V {
    const node = this.#cache.get(key);
    if (node) {
      this.#moveToTail(node);
      return node.value;
    }
    const value = callbackfn(key);
    this.set(key, value);
    return value;
  }

  clear(): void {
    this.#cache.clear();
    this.#head = null;
    this.#tail = null;
  }

  *keys(): MapIterator<K> {
    let current = this.#head;
    while (current) {
      yield current.key;
      current = current.next;
    }
  }

  *values(): MapIterator<V> {
    let current = this.#head;
    while (current) {
      yield current.value;
      current = current.next;
    }
  }

  *entries(): MapIterator<[K, V]> {
    let current = this.#head;
    while (current) {
      yield [current.key, current.value];
      current = current.next;
    }
  }

  forEach(
    callbackfn: (value: V, key: K, map: Map<K, V>) => void,
    thisArg?: unknown,
  ): void {
    let current = this.#head;
    while (current) {
      callbackfn.call(thisArg, current.value, current.key, this);
      current = current.next;
    }
  }

  [Symbol.iterator](): MapIterator<[K, V]> {
    return this.entries();
  }

  #removeNode(node: ListNode<K, V>): void {
    if (node.prev) node.prev.next = node.next;
    else this.#head = node.next;

    if (node.next) node.next.prev = node.prev;
    else this.#tail = node.prev;
  }

  #addToTail(node: ListNode<K, V>): void {
    node.prev = this.#tail;
    node.next = null;

    if (this.#tail) this.#tail.next = node;
    else this.#head = node;

    this.#tail = node;
  }

  #moveToTail(node: ListNode<K, V>): void {
    if (node === this.#tail) return;
    this.#removeNode(node);
    this.#addToTail(node);
  }

  #removeHead(): void {
    /* v8 ignore if -- @preserve */
    if (!this.#head) return;
    this.#cache.delete(this.#head.key);
    this.#removeNode(this.#head);
  }
}
