import { pairId, type ResourceKey } from '@terra/contracts';

/** Tier-1 bases the guild quotes. Cash books are not in this list. */
export const TIER1_RESOURCES = ['metals.t1', 'minerals.t1', 'bio.water', 'bio.biomass'] as const;
export type Tier1Resource = (typeof TIER1_RESOURCES)[number];

export interface BarterPair {
  readonly base: Tier1Resource;
  readonly quote: Tier1Resource;
}

/**
 * One barter book per Tier-1 base. The quote is the next Tier-1 resource, so a dock can rest a bid and an ask
 * while `cashEnabled` is 0. USDC and NEAR bids stay paused in `quoteGuild`.
 */
export function tier1BarterPairs(): readonly BarterPair[] {
  return TIER1_RESOURCES.map((base, i) => ({
    base,
    quote: TIER1_RESOURCES[(i + 1) % TIER1_RESOURCES.length]!,
  }));
}

export function barterPairIds(): string[] {
  return tier1BarterPairs().map((p) => pairId(p.base, p.quote));
}

export function isTier1(resource: string): resource is Tier1Resource {
  return (TIER1_RESOURCES as readonly string[]).includes(resource);
}

export function asResource(resource: Tier1Resource): ResourceKey {
  return resource;
}
