/**
 * Generic in-memory TTL cache (unification roadmap target #1).
 *
 * Several subsystems hand-roll a `Map<key, { value, cachedAt|expires }>` plus a
 * TTL check and an invalidate function. This primitive consolidates that single
 * pattern. It is intentionally general (key type `K`, value type `V`) because
 * the consumers are heterogeneous — some key by guildId, some by messageId, and
 * some need a guild-scoped invalidate over a messageId-keyed cache (hence
 * {@link TtlCache.invalidateWhere}).
 *
 * Closure-based and destructure-safe: the returned methods don't use `this`, so
 * `const { get, set } = createTtlCache(...)` works.
 *
 * Note: a missing key and a cached `undefined` are indistinguishable via
 * `get()`. Consumers that cache "empty" results should use a sentinel value
 * (e.g. an empty array), which round-trips fine.
 */

export interface TtlCache<K, V> {
  /** Returns the value, or `undefined` if absent or expired (stale entries are evicted on read). */
  get(key: K): V | undefined;
  /** Store a value, stamping it with the current time for TTL purposes. */
  set(key: K, value: V): void;
  /**
   * Return the cached value, or run `loader` and cache its result. Only
   * non-null/non-undefined results are cached (matches the common
   * "don't cache misses" behavior). `loader` errors propagate uncached.
   */
  getOrLoad(key: K, loader: (key: K) => Promise<V>): Promise<V>;
  /** Drop a single key. */
  invalidate(key: K): void;
  /** Drop every entry whose value (or key) matches the predicate. */
  invalidateWhere(predicate: (value: V, key: K) => boolean): void;
  /** Drop all entries. */
  clear(): void;
  /** Number of entries currently held (including not-yet-evicted stale ones). */
  readonly size: number;
}

interface Entry<V> {
  value: V;
  cachedAt: number;
}

/**
 * Create a TTL cache with the given lifetime (ms).
 *
 * @param ttlMs entry lifetime in milliseconds
 * @param now injectable clock (defaults to `Date.now`) — used by tests to
 *   exercise expiry deterministically without real timers.
 */
export function createTtlCache<K, V>(ttlMs: number, now: () => number = Date.now): TtlCache<K, V> {
  const store = new Map<K, Entry<V>>();

  function get(key: K): V | undefined {
    const entry = store.get(key);
    if (!entry) return undefined;
    if (now() - entry.cachedAt >= ttlMs) {
      store.delete(key); // evict stale on read
      return undefined;
    }
    return entry.value;
  }

  function set(key: K, value: V): void {
    store.set(key, { value, cachedAt: now() });
  }

  async function getOrLoad(key: K, loader: (key: K) => Promise<V>): Promise<V> {
    const cached = get(key);
    if (cached !== undefined) return cached;
    const loaded = await loader(key);
    if (loaded !== undefined && loaded !== null) set(key, loaded);
    return loaded;
  }

  function invalidate(key: K): void {
    store.delete(key);
  }

  function invalidateWhere(predicate: (value: V, key: K) => boolean): void {
    for (const [key, entry] of store) {
      if (predicate(entry.value, key)) store.delete(key);
    }
  }

  function clear(): void {
    store.clear();
  }

  return {
    get,
    set,
    getOrLoad,
    invalidate,
    invalidateWhere,
    clear,
    get size() {
      return store.size;
    },
  };
}
