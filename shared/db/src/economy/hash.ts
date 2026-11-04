import { createHash } from 'node:crypto';
import type { ProfileContent } from '@terra/contracts';

/** Canonical JSON (sorted object keys, array order kept) so equal content always hashes equal. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
}

/** `sha256:<hex>` of the canonical `ProfileContent` JSON (the `contentHash` of a version and `EconomyProfileRef.hash`). */
export function contentHashOf(content: ProfileContent): string {
  return `sha256:${createHash('sha256').update(canonicalJson(content)).digest('hex')}`;
}
