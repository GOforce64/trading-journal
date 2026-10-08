/** A uniform draw on [0, 1). Every random choice in the demo comes from one, so a seed fixes all of it. */
export type Rng = () => number;

/** mulberry32: small, fast and good enough for fake trades. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a over `key`, mixed with `seed`: each key gets its own stream from one seed. */
export function hashSeed(seed: number, key: string): number {
  let hash = (0x811c9dc5 ^ seed) >>> 0;
  for (let index = 0; index < key.length; index++) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** A stream of its own for `key` (a symbol, a day), so adding one never shifts another's numbers. */
export const stream = (seed: number, key: string): Rng => mulberry32(hashSeed(seed, key));

export const uniform = (rng: Rng, min: number, max: number): number => min + (max - min) * rng();

/** An integer from `min` to `max`, both included. */
export const int = (rng: Rng, min: number, max: number): number => Math.floor(uniform(rng, min, max + 1));

/** A standard normal draw (Box–Muller). */
export function normal(rng: Rng): number {
  const u = 1 - rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export const chance = (rng: Rng, p: number): boolean => rng() < p;

export function pick<T>(rng: Rng, list: readonly T[]): T {
  const item = list[Math.floor(rng() * list.length)];
  if (item === undefined) throw new Error("pick from an empty list");
  return item;
}

/** One of `items`, each as likely as its weight. */
export function weighted<T>(rng: Rng, items: readonly (readonly [T, number])[]): T {
  const total = items.reduce((sum, [, weight]) => sum + weight, 0);
  let left = rng() * total;
  for (const [item, weight] of items) {
    if (left < weight) return item;
    left -= weight;
  }
  const last = items.at(-1);
  if (!last) throw new Error("a weighted pick from an empty list");
  return last[0];
}
