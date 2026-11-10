import type { AwayDigestV1 } from '@terra/contracts';

/** Join welcomes carry the closed digest. Resync welcomes omit it and must not reopen the modal. */
export function digestFromWelcome(d: { reason?: string; away?: AwayDigestV1 }): AwayDigestV1 | null {
  if (d.reason === 'resync' || d.away == null) return null;
  return d.away;
}
