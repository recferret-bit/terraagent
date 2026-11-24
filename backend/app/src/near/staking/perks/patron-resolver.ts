import { STAKING_TIERS } from '@terra/contracts';
import { ONE_NEAR_YOCTO } from '../yocto.js';

/** Minimum active stake to hold the Lead Patron seat (the Tier 4 row, in yocto). */
export const PATRON_MIN_YOCTO = BigInt(STAKING_TIERS[4]!.minStakeNear) * ONE_NEAR_YOCTO;

/** `ISS <handle>.near`: the first label of the wallet id, as the orbit-menu Flagship Carrier name. */
export const carrierNameFor = (accountId: string): string => `ISS ${accountId.split('.')[0] ?? accountId}.near`;

export interface PatronCandidate {
  readonly accountId: string;
  /** Wallet-wide ACTIVE stake (unbonding excluded). */
  readonly activeStakedYocto: bigint;
  /** Start of the wallet's continuous stake, ms; `null` = unknown (loses every tie-break). */
  readonly stakedSinceMs: number | null;
}

/**
 * King-of-the-Hill (pure): the highest ACTIVE stake `>= 500 NEAR` among the wallets nominating the planet.
 * Ties keep the incumbent, else the earliest stake (then account id for determinism). A challenger needs strictly
 * more stake to unseat the incumbent, and an incumbent that unstakes below 500 or below the runner-up loses the seat
 * on the next evaluation (no cooldown), so the seat never sits with a wallet that is no longer the best.
 */
export function resolveLeadPatron(
  candidates: readonly PatronCandidate[],
  incumbentAccountId: string | null,
): PatronCandidate | null {
  let best: PatronCandidate | null = null;
  for (const c of candidates) {
    if (c.activeStakedYocto < PATRON_MIN_YOCTO) continue;
    if (best === null || beats(c, best, incumbentAccountId)) best = c;
  }
  return best;
}

function beats(a: PatronCandidate, b: PatronCandidate, incumbent: string | null): boolean {
  if (a.activeStakedYocto !== b.activeStakedYocto) return a.activeStakedYocto > b.activeStakedYocto;
  if (incumbent !== null && a.accountId !== b.accountId) {
    if (a.accountId === incumbent) return true;
    if (b.accountId === incumbent) return false;
  }
  const sa = a.stakedSinceMs ?? Number.POSITIVE_INFINITY;
  const sb = b.stakedSinceMs ?? Number.POSITIVE_INFINITY;
  if (sa !== sb) return sa < sb;
  return a.accountId < b.accountId;
}

/** Deterministic King-of-the-Hill ranking: eligible (`>= 500 NEAR`) first via `beats`, then `< 500 NEAR` by stake/clock. */
export function comparePatronCandidates(
  a: PatronCandidate,
  b: PatronCandidate,
  incumbentAccountId: string | null,
): number {
  if (a.accountId === b.accountId) return 0;
  const aElig = a.activeStakedYocto >= PATRON_MIN_YOCTO;
  const bElig = b.activeStakedYocto >= PATRON_MIN_YOCTO;
  if (aElig !== bElig) return aElig ? -1 : 1;
  return beats(a, b, aElig ? incumbentAccountId : null) ? -1 : 1;
}
