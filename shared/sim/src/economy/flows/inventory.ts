import { RESOURCE_KEYS, type ResourceKey } from '@terra/contracts';
import type { ColonyState } from '../../kernel/state';
import { colonyResourcePosition } from '../position';
import { netConsumption, totalProduction, type ResourceFlow } from './accounting';

/**
 * `inventory_next = inventory + production + imports - consumption - exports` (ECONOMY §2), whole units, with
 * `consumption` net of recovered resources and `transfers` the net move between colonies (0 at global scope).
 * Capped output is not an input: it never reached the inventory.
 */
export function inventoryNext(inventory: bigint, flow: ResourceFlow): bigint {
  return inventory + totalProduction(flow) + flow.imports - netConsumption(flow) - flow.exports + (flow.transferIn - flow.transferOut);
}

export interface GlobalInventory {
  /** Value in micro-units of active owners: stock + orbit + in-flight + residual, each counted once. */
  readonly activeMicro: bigint;
  /** Owners listed as inactive, reported apart (never added to supply). */
  readonly inactiveMicro: bigint;
  /** Market-reserved part of orbital custody, whole units: a SUBSET of `inOrbit`, never extra supply. */
  readonly reservedInOrbit: bigint;
  /** Whole units of `stock`, `inOrbit` and `inFlight` over active owners (for display and the identity check). */
  readonly stock: bigint;
  readonly inOrbit: bigint;
  readonly inFlight: bigint;
}

/**
 * The global position of `key`: sums `colonyResourcePosition` over every colony once, so cargo that left one colony's
 * stock for orbit or flight is still counted (once) and a transfer between two colonies changes nothing. `inOrbit` is
 * the sim's mirror of verifier custody and is not added again. `inactive` colony indices are reported separately.
 */
export function globalInventory(colonies: readonly (ColonyState | undefined)[], key: ResourceKey, inactive: ReadonlySet<number> = new Set()): GlobalInventory {
  let active = 0n, idle = 0n, reserved = 0n, stock = 0n, orbit = 0n, flight = 0n;
  for (const c of colonies) {
    if (!c) continue;
    const p = colonyResourcePosition(c, key);
    const total = BigInt(p.totalMicro);
    if (inactive.has(c.index)) { idle += total; continue; }
    active += total;
    reserved += BigInt(p.reservedInOrbit);
    stock += BigInt(p.stock);
    orbit += BigInt(p.inOrbit);
    flight += BigInt(p.inFlight);
  }
  return { activeMicro: active, inactiveMicro: idle, reservedInOrbit: reserved, stock, inOrbit: orbit, inFlight: flight };
}

/** `globalInventory` of every key. */
export function globalInventoryAll(colonies: readonly (ColonyState | undefined)[], inactive?: ReadonlySet<number>): Record<ResourceKey, GlobalInventory> {
  const out = {} as Record<ResourceKey, GlobalInventory>;
  for (const k of RESOURCE_KEYS) out[k] = globalInventory(colonies, k, inactive);
  return out;
}
