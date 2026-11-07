import { potentialBuy } from '../../../economy/flows/calculators';
import type { AgentColonyInput } from './types';

/** Desired buy quantity: `potentialBuy` (planned consumption + reserve - stock - expected own production), never negative. */
export const desiredBuyQty = (need: AgentColonyInput['need']): bigint => potentialBuy(need);

/** Surplus a sell may offer: free units above the keep level (zero when at or below it). */
export function sellableQty(freeUnits: bigint, keepUnits: bigint): bigint {
  const spare = freeUnits - (keepUnits > 0n ? keepUnits : 0n);
  return spare > 0n ? spare : 0n;
}

/**
 * Target inventory from a storage cap and a target band (`market.resource.*.targetBandLoBp/HiBp`, bp of the cap): the middle
 * of the band, rounded down. A cap or band that is not positive gives 0 (no target), never a negative.
 */
export function targetFromBand(storageCap: bigint, loBp: number, hiBp: number): bigint {
  if (storageCap <= 0n || hiBp < loBp || loBp < 0) return 0n;
  return (storageCap * BigInt(loBp + hiBp)) / 20_000n;
}

/** Rounds `units` down to a multiple of the lot; a lot below 1 is treated as 1. */
export function wholeLots(units: bigint, lotUnits: number): bigint {
  const lot = BigInt(Math.max(1, Math.floor(lotUnits)));
  return units > 0n ? (units / lot) * lot : 0n;
}
