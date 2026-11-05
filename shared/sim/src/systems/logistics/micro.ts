import { RESIDUAL_SCALE } from '../../economy/residual';
import type { ColonyState } from '../../kernel/state';
import { consumeResource, creditResource, ensureColonyLedger } from '../economy/ledger';
import type { ResourceKey } from '@terra/contracts';
import type { MicroMap } from './state';

export const addMicro = (m: MicroMap, k: string, v: number): void => { if (v !== 0) m[k] = (m[k] ?? 0) + v; };
export const sumMap = (m: MicroMap): number => Object.values(m).reduce((a, b) => a + b, 0);
export const cleanMap = (m: MicroMap): MicroMap => Object.fromEntries(Object.entries(m).filter(([, v]) => v !== 0).sort(([a], [b]) => (a < b ? -1 : 1)));

/** Exact stock value in micro-units (whole stock plus residual). */
export function stockMicro(colony: ColonyState, key: string): number {
  const c = ensureColonyLedger(colony);
  return (c.stock[key as ResourceKey] ?? 0) * RESIDUAL_SCALE + (c.residual[key as ResourceKey] ?? 0);
}

/** Moves `micro` of every resource out of the colony as `logistics.supply` (whole units posted, rest in the residual). */
export function reserveFromColony(colony: ColonyState, amounts: MicroMap, tick: number): void {
  for (const k of Object.keys(amounts).sort()) {
    if (amounts[k]! > 0) consumeResource(colony, k as ResourceKey, amounts[k]! / RESIDUAL_SCALE, tick, 'logistics.supply');
  }
}

/** Returns `micro` of every resource to the colony as `logistics.release` (not counted as produced). */
export function releaseToColony(colony: ColonyState, amounts: MicroMap, tick: number): void {
  for (const k of Object.keys(amounts).sort()) {
    if (amounts[k]! > 0) creditResource(colony, k as ResourceKey, amounts[k]! / RESIDUAL_SCALE, tick, { produced: false, reason: 'logistics.release' });
  }
}
