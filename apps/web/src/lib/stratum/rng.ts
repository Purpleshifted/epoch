/**
 * stratum/rng.ts
 *
 * Deterministic hashing. Every view (mobile / side / top) recomputes an item's
 * fate on its own, so the fate must depend only on stored data (id, material,
 * times) and never on Math.random().
 */

/** Stable pseudo-random number in [0, 1) from a string key and a salt. */
export function hash01(key: string, salt = ""): number {
  const s = key + "\u0000" + salt;
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  h ^= h >>> 16; // murmur3 finaliser
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Small seeded generator (tests, and anything that needs a sequence). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
