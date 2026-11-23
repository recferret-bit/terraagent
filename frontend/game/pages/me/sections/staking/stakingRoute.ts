// Hash routing for `/me.html#staking?amount=<X>` (the landing CTA links to exactly `#staking?amount=200`).
// The amount lives INSIDE the hash fragment, after the `?`, so `location.search` never carries it.
import { STAKING_RULES } from '@terra/contracts/staking/tiers';

export const STAKING_SECTION_ID = 'staking';
/** Upper clamp for a previewed stake (whole NEAR). */
export const MAX_PREVIEW_NEAR = 1_000_000;

export interface StakingRoute {
  /** True when the hash targets the staking tab (`#staking`, `#staking?amount=…`). */
  readonly active: boolean;
  /** Validated amount in NEAR; always finite, `> 0` and `<= MAX_PREVIEW_NEAR`. */
  readonly amount: number;
}

/** Junk, NaN, non-finite, zero and negative input fall back to the default preview; values above the max clamp. */
export function sanitizeStakeAmount(raw: unknown): number {
  const fallback = STAKING_RULES.defaultPreviewNear;
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw.trim()) : NaN;
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(MAX_PREVIEW_NEAR, Math.round(n * 100) / 100) || fallback;
}

export function parseStakingHash(hash: string): StakingRoute {
  const body = hash.startsWith('#') ? hash.slice(1) : hash;
  const q = body.indexOf('?');
  const id = (q === -1 ? body : body.slice(0, q)).trim().toLowerCase();
  if (id !== STAKING_SECTION_ID) return { active: false, amount: STAKING_RULES.defaultPreviewNear };
  const params = new URLSearchParams(q === -1 ? '' : body.slice(q + 1));
  return { active: true, amount: sanitizeStakeAmount(params.get('amount')) };
}

export const stakingHash = (amount: number): string => `#${STAKING_SECTION_ID}?amount=${sanitizeStakeAmount(amount)}`;
