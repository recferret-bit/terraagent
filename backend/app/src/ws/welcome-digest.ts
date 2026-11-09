import type { AwayDigestV1 } from '@terra/contracts';

/** Join copies the closed digest onto `d.away`. Resync, and a colony with nothing unseen, leave the key off. */
export function welcomeFields(reason: 'join' | 'resync', away: AwayDigestV1 | null): { away?: AwayDigestV1 } {
  if (reason !== 'join' || !away) return {};
  return { away };
}
