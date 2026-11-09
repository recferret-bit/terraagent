import { RESOURCE_KEYS, type ResourceKey } from '@terra/contracts';
import type { ColonyState } from '../kernel/state';
import { RESIDUAL_SCALE, valueMicro } from './residual';

/** A colony's value of one resource, by where it is. */
export interface ResourcePosition {
  /** In the colony's storage (`col.stock`), whole units. */
  stock: number;
  /** Sub-unit value kept by the residual accumulator, in micro-units (`< RESIDUAL_SCALE`). */
  residualMicro: number;
  /** In orbital custody (`col.cargo.inOrbit`), whole units. */
  inOrbit: number;
  /** Exported but not yet settled (`pendingMint`) plus imported out of orbit but not yet settled (`pendingImport`). */
  inFlight: number;
  /**
   * Part of {@link inOrbit} that a market order has locked (`colony.market.reservedInOrbit`, W13-10). A SUBSET of
   * `inOrbit`, never added again: reserving moves nothing, it only stops the amount being sold twice.
   */
  reservedInOrbit: number;
  /** `stock + inOrbit + inFlight` in micro-units plus the residual: the one total that export, settle and import keep. */
  totalMicro: number;
}

export type ResourcePositionMap = Record<ResourceKey, ResourcePosition>;

const numberOf = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/**
 * HOOK for W13-10 (market sim module, not merged when this was written): the amount of `key` the colony has locked in
 * `colony.market.reservedInOrbit`. Returns 0 until that field exists; W13-10 only has to keep the field name. It is a
 * subset of orbit custody, so it is reported next to the total and never summed into it.
 */
export function reservedInOrbitOf(colony: ColonyState, key: ResourceKey): number {
  const market = colony.market as { reservedInOrbit?: Partial<Record<ResourceKey, number>> } | undefined;
  return numberOf(market?.reservedInOrbit?.[key]);
}

/**
 * The one place a colony's resource position is computed (pure, reads only): storage + orbit custody + in-flight
 * cargo, each counted once. Cargo moves value between these three places, so the sum is constant across an export,
 * its settlement and an import: export moves stock into `pendingMint`, settling moves it to `inOrbit`; an import
 * moves `inOrbit` into `pendingImport` (`debitedInOrbit`), settling moves it into stock. An import that did not take
 * from orbit (`debitedInOrbit` unset: orbit never tracked that resource) is value arriving from outside, not
 * in flight from orbit, so it is not counted before it settles.
 */
export function colonyResourcePosition(colony: ColonyState, key: ResourceKey): ResourcePosition {
  const stock = numberOf((colony.stock as Partial<Record<ResourceKey, number>> | undefined)?.[key]);
  const residualMicro = numberOf((colony.residual as Partial<Record<ResourceKey, number>> | undefined)?.[key]);
  const cargo = colony.cargo as {
    inOrbit?: Partial<Record<ResourceKey, number>>;
    pendingMint?: Record<string, { resource?: string; amount?: number }>;
    pendingImport?: Record<string, { resource?: string; amount?: number; debitedInOrbit?: boolean }>;
  } | undefined;
  const inOrbit = numberOf(cargo?.inOrbit?.[key]);
  let inFlight = 0;
  for (const p of Object.values(cargo?.pendingMint ?? {})) if (p.resource === key) inFlight += numberOf(p.amount);
  for (const p of Object.values(cargo?.pendingImport ?? {})) {
    if (p.resource === key && p.debitedInOrbit === true) inFlight += numberOf(p.amount);
  }
  const reservedInOrbit = Math.min(inOrbit, reservedInOrbitOf(colony, key));
  const totalMicro = valueMicro(stock + inOrbit + inFlight, residualMicro);
  return { stock, residualMicro, inOrbit, inFlight, reservedInOrbit, totalMicro };
}

/** {@link colonyResourcePosition} of every resource key. */
export function colonyPosition(colony: ColonyState): ResourcePositionMap {
  const out = {} as ResourcePositionMap;
  for (const key of RESOURCE_KEYS) out[key] = colonyResourcePosition(colony, key);
  return out;
}

/** A position's total as a number of units (for display and tests). */
export const positionUnits = (p: ResourcePosition): number => p.totalMicro / RESIDUAL_SCALE;
