import { threadOf } from './thread/assign';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32, as ULIDs

/** `pl_` + 26 ULID-shaped characters derived from a counter. */
function candidate(k: number): string {
  let s = '';
  for (let n = k, i = 0; i < 6; i++, n = Math.floor(n / 32)) s = ALPHABET[n % 32] + s;
  return `pl_${'0'.repeat(20)}${s}`;
}

/**
 * Deterministic ids for `count` dev planets, spread evenly over `threads`: planet i is the first candidate hashing to
 * thread `i % threads`, so 6 planets on 3 threads are exactly 2 per thread (and any count differs by at most one).
 */
export function devPlanetIds(count: number, threads: number): string[] {
  const ids: string[] = [];
  const used = new Set<string>();
  let k = 0;
  for (let i = 0; i < count; i++) {
    const want = i % threads;
    let id: string;
    do id = candidate(k++); while (threadOf(id, threads) !== want || used.has(id));
    used.add(id);
    ids.push(id);
  }
  return ids;
}
