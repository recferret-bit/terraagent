import { hashString } from '../kernel/rng';

/** Canonical JSON (sorted keys) so equal data always hashes equal, whatever the key order. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
}

/** Short stable hash of compiled data (`welcome.dataHash`, SIM-X-08): two FNV-1a passes → 16 hex chars. */
export function dataHash(v: unknown): string {
  const s = canonical(v);
  const a = hashString(s), b = hashString(s, 0x9747b28c);
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}
