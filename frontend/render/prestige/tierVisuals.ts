import { STAKING_TIER_IDS } from '@terra/contracts/staking/tiers';

/**
 * W28-12: the cosmetic look a staking tier buys. Pure data in, plain flags out. Staking never enters `@terra/sim`, so
 * the game app fetches tiers and passes plain numbers here; nothing in `render/` reads wallet or contract state.
 */
export interface PrestigeVisuals {
  /** The tier these flags were derived from (0 for anything that is not a known tier). */
  readonly tier: number;
  /** Tier 1+: cyan orbital uplink beam above the Command Hub. */
  readonly uplinkBeam: boolean;
  /** Tier 1+: rotating Quantum Dish on the Command Hub roof. */
  readonly quantumDish: boolean;
  /** Tier 2+: plasma re-entry trail behind the colony's own drop pod. */
  readonly plasmaTrail: boolean;
  /** Tier 2+: the colony's work beams are cyan. */
  readonly cyanCutters: boolean;
  /** Tier 3+: gold-anodized trim on the Command Hub. */
  readonly goldTrim: boolean;
  /** Tier 4 (the planet's Lead Patron): a named flagship carrier in the orbit menu. */
  readonly flagshipCarrier: boolean;
}

const NONE: PrestigeVisuals = Object.freeze({
  tier: 0, uplinkBeam: false, quantumDish: false, plasmaTrail: false, cyanCutters: false, goldTrim: false, flagshipCarrier: false,
});

const MAX_TIER = STAKING_TIER_IDS[STAKING_TIER_IDS.length - 1];
const cache = new Map<number, PrestigeVisuals>();

/** True for 0..4 integers only. NaN, fractions, negatives, strings and tiers above the table are "no prestige". */
export function isKnownPrestigeTier(tier: unknown): tier is number {
  return typeof tier === 'number' && Number.isInteger(tier) && tier >= 0 && tier <= MAX_TIER;
}

/** Tier 0 and any unknown value give the standard colony hull (no flags). Results are shared and frozen. */
export function prestigeVisualsForTier(tier: unknown): PrestigeVisuals {
  if (!isKnownPrestigeTier(tier) || tier === 0) return NONE;
  let v = cache.get(tier);
  if (!v) {
    v = Object.freeze({
      tier,
      uplinkBeam: tier >= 1,
      quantumDish: tier >= 1,
      plasmaTrail: tier >= 2,
      cyanCutters: tier >= 2,
      goldTrim: tier >= 3,
      flagshipCarrier: tier >= MAX_TIER,
    });
    cache.set(tier, v);
  }
  return v;
}

/** Catalog id of the Command Hub for a tier: dish from tier 1, gold trim from tier 3. */
export function hubArchetypeForTier(tier: unknown): string {
  const v = prestigeVisualsForTier(tier);
  if (v.goldTrim) return HUB_GOLD_ID;
  return v.quantumDish ? HUB_UPLINK_ID : HUB_BASE_ID;
}

export const HUB_BASE_ID = 'building.commandHub';
export const HUB_UPLINK_ID = 'building.commandHub.uplink';
export const HUB_GOLD_ID = 'building.commandHub.gold';
export const FLAGSHIP_CARRIER_ID = 'ship.flagshipCarrier';

/** The base hub id for any hub variant id (rig, cable-port and light tables are keyed by the base only). */
export function baseHubArchetypeId(id: string): string {
  return id === HUB_UPLINK_ID || id === HUB_GOLD_ID ? HUB_BASE_ID : id;
}
