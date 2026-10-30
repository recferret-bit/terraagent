/**
 * PRNG (SIM-D-04): xoshiro128** with one 4-word state per named stream, seeded from the planet seed and the stream
 * name. Stream states are part of the snapshot and the delta, so a replica draws the same numbers.
 * `Math.random` is banned in the engine; every random draw goes through a stream.
 */
export const RNG_STREAMS = ['gen', 'weather', 'hazard', 'fauna', 'ai', 'combat', 'misc'] as const;
export type RngStream = (typeof RNG_STREAMS)[number];
export type RngState = Record<RngStream, Uint32Array>;

/** FNV-1a over UTF-16 code units: a stable 32-bit hash of a string (no TextEncoder needed). */
export function hashString(s: string, h = 0x811c9dc5): number {
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
}

export function seedStream(seed: string, stream: string): Uint32Array {
  const next = splitmix32(hashString(stream, hashString(seed)));
  const st = new Uint32Array([next(), next(), next(), next()]);
  if (!(st[0] | st[1] | st[2] | st[3])) st[0] = 1; // xoshiro must not start all-zero
  return st;
}

export function seedRng(seed: string): RngState {
  return Object.fromEntries(RNG_STREAMS.map((s) => [s, seedStream(seed, s)])) as RngState;
}

const rotl = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0;

/** Next uint32 from a xoshiro128** state (mutates it). */
export function nextU32(s: Uint32Array): number {
  const result = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0;
  const t = (s[1] << 9) >>> 0;
  s[2] ^= s[0];
  s[3] ^= s[1];
  s[1] ^= s[2];
  s[0] ^= s[3];
  s[2] ^= t;
  s[3] = rotl(s[3], 11);
  return result;
}

/** A float in [0, 1). */
export const nextFloat = (s: Uint32Array) => nextU32(s) / 4294967296;
/** An integer in [lo, hi] inclusive. */
export const nextInt = (s: Uint32Array, lo: number, hi: number) => lo + Math.floor(nextFloat(s) * (hi - lo + 1));
