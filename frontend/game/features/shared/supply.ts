import type { ColonySupply } from '@terra/sim';
import { viewColony } from './colony';

/**
 * The client side of unit supply: the host computes `colony.supply` (`shared/sim/src/systems/supply`) and every HUD
 * piece reads it here. The client never counts units itself.
 */
export type SupplyLevel = 'ok' | 'warn' | 'full';

/** Fraction of the cap from which the header warns (8 / 10 used). */
export const SUPPLY_WARN_RATIO = 0.8;

/** The own colony's supply from a view, or `null` before the host sent one. */
export function readColonySupply(view: unknown, colonyIndex: number): ColonySupply | null {
  const s = viewColony(view, colonyIndex)?.supply as Partial<ColonySupply> | undefined;
  if (!s || typeof s.used !== 'number' || typeof s.cap !== 'number') return null;
  return {
    used: s.used,
    cap: s.cap,
    units: s.units ?? s.used,
    reserved: s.reserved ?? 0,
    available: s.available ?? Math.max(0, s.cap - s.used),
    max: s.max ?? s.cap,
    sources: Array.isArray(s.sources) ? s.sources : [],
  };
}

/** `full` at (or over) the cap, `warn` from {@link SUPPLY_WARN_RATIO} of it, else `ok`. */
export function supplyLevel(s: Pick<ColonySupply, 'used' | 'cap'> | null): SupplyLevel {
  if (!s) return 'ok';
  if (s.used >= s.cap) return 'full';
  return s.used >= s.cap * SUPPLY_WARN_RATIO ? 'warn' : 'ok';
}

/** Why one more unit of `unitSupply` cannot be ordered now, or `null` when it fits. */
export function supplyBlockReason(s: Pick<ColonySupply, 'used' | 'cap'> | null, unitSupply: number): string | null {
  if (!s || unitSupply <= 0 || s.used + unitSupply <= s.cap) return null;
  return SUPPLY_CAP_TEXT;
}

/** The one wording of "no room for another unit" (reject toast, disabled unit button). */
export const SUPPLY_CAP_TEXT = 'Supply cap reached — build a Supply Depot';
