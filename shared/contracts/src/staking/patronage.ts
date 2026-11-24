import { z } from 'zod';
import {
  CANONICAL_PLANETS,
  CANONICAL_PLANET_IDS,
  CANONICAL_PLANET_LIST,
  canonicalPlanetById,
  isCanonicalPlanetId,
  type CanonicalPlanetDef,
  type CanonicalPlanetId,
} from '../lobby/atlas';

const Near = z.string().regex(/^\d+(\.\d+)?$/);
const Ms = z.number().int().nonnegative();

/**
 * Only the three shared canonical worlds support King-of-the-Hill Planetary Patronage.
 * Paid sovereign NFT planets have private governance and are explicitly excluded.
 */
export const PATRONAGE_PLANETS: readonly CanonicalPlanetDef[] = CANONICAL_PLANET_LIST;

export const PATRONAGE_PLANET_IDS: readonly [string, string, string] = CANONICAL_PLANET_IDS;

export const PATRONAGE_NON_ELIGIBLE_MESSAGE =
  'Planetary Patronage is only available on the three canonical public worlds (Kharon Dunes, Thalassa Verde, Granite Hollow); sovereign NFT planets are not eligible.';

export function isPatronageEligiblePlanetId(
  planetId: string | null | undefined,
): planetId is CanonicalPlanetId {
  return typeof planetId === 'string' && isCanonicalPlanetId(planetId.trim());
}

export function resolveDefaultPatronagePlanetId(hintPlanetId?: string | null): CanonicalPlanetId {
  if (isPatronageEligiblePlanetId(hintPlanetId)) {
    return hintPlanetId.trim() as CanonicalPlanetId;
  }
  return CANONICAL_PLANETS.temperate.id;
}

export function patronagePlanetName(planetId: string): string {
  return canonicalPlanetById(planetId)?.name ?? planetId;
}

export function formatPatronagePlanetLabel(planetId: string): string {
  const def = canonicalPlanetById(planetId);
  return def ? `${def.name} (${def.id})` : planetId;
}

/** One King-of-the-Hill seat: the highest active `≥500 NEAR` staker nominating the planet. */
export const PlanetPatronView = z.strictObject({
  planetId: z.string().min(1).max(80),
  accountId: z.string().min(2).max(64),
  /** `ISS <handle>.near` (shown on the orbit-menu Flagship Carrier). */
  carrierName: z.string().min(1).max(96),
  activeStakedNear: Near,
  sinceMs: Ms,
  /** Share of the Protocol's trade-fee cut paid to the patron (`1500` = `15 %`). */
  protocolFeeShareBp: z.number().int().nonnegative(),
});
export type PlanetPatronView = z.infer<typeof PlanetPatronView>;

export const PatronContenderStatus = z.enum(['lead', 'contender', 'below_threshold']);
export type PatronContenderStatus = z.infer<typeof PatronContenderStatus>;

export const PatronContenderRow = z.strictObject({
  rank: z.number().int().positive(),
  accountId: z.string().min(2).max(64),
  carrierName: z.string().min(1).max(96),
  activeStakedNear: Near,
  tier: z.number().int().min(0).max(4),
  status: PatronContenderStatus,
  gapToLeadNear: Near,
  stakedSinceMs: Ms.nullable(),
  nominatedAtMs: Ms,
  isSelf: z.boolean(),
});
export type PatronContenderRow = z.infer<typeof PatronContenderRow>;

export const PatronHistoryEventKind = z.enum([
  'seat_claimed',
  'seat_overtaken',
  'seat_vacated',
  'nominated',
  'fee_payout',
]);
export type PatronHistoryEventKind = z.infer<typeof PatronHistoryEventKind>;

export const PatronHistoryRow = z.strictObject({
  id: z.string().min(1).max(160),
  planetId: z.string().min(1).max(80),
  accountId: z.string().min(2).max(64),
  carrierName: z.string().min(1).max(96),
  kind: PatronHistoryEventKind,
  activeStakedNear: Near,
  previousAccountId: z.string().min(2).max(64).nullable(),
  previousStakedNear: Near.nullable(),
  payoutUsd: z.number().nonnegative().nullable(),
  atMs: Ms,
});
export type PatronHistoryRow = z.infer<typeof PatronHistoryRow>;

export const PlanetPatronCompetitionView = z.strictObject({
  planetId: z.string().min(1).max(80),
  leadPatron: PlanetPatronView.nullable(),
  stakeToLeadNear: Near,
  totalContenders: z.number().int().nonnegative(),
  contenders: z.array(PatronContenderRow),
  history: z.array(PatronHistoryRow),
});
export type PlanetPatronCompetitionView = z.infer<typeof PlanetPatronCompetitionView>;

export const PlanetaryPatronageView = z.strictObject({
  nominatedPlanetId: z.string().min(1).max(80).nullable(),
  planets: z.array(PlanetPatronCompetitionView),
});
export type PlanetaryPatronageView = z.infer<typeof PlanetaryPatronageView>;
