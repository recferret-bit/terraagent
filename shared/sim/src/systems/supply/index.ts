import type { CompiledDataLike } from '../../kernel/config';
import type { PlanetState } from '../../kernel/state';
import { defineSystem } from '../../kernel/system';
import { defineSimModule } from '../define';
import { computeColonySupply, type ColonySupply, type SupplyReadOpts } from './compute';

export * from './compute';
export { supplySources, unitSupplyOfKind, unitSupplyOfName, type SupplyProvider, type SupplySources } from './sources';

/**
 * Unit supply (W02 production, owner feedback W03): the single source of truth for `colony.supply`
 * (`{ used, units, reserved, cap, available, max, sources }`). Everything that asks "may this colony make one more
 * unit" calls {@link checkUnitSupply}; everything that shows supply reads `colony.supply` (written only here).
 */

function sameSupply(a: ColonySupply | undefined, b: ColonySupply): boolean {
  if (!a || a.used !== b.used || a.units !== b.units || a.reserved !== b.reserved || a.cap !== b.cap || a.max !== b.max) return false;
  if (!Array.isArray(a.sources) || a.sources.length !== b.sources.length) return false;
  return a.sources.every((s, i) => s.building === b.sources[i].building && s.count === b.sources[i].count && s.total === b.sources[i].total);
}

/**
 * Recomputes colony `colonyIndex`'s supply and writes `colony.supply`, stamping `changedAt` only when it changed (the
 * delta then carries the colony; an unchanged colony costs the diff nothing).
 */
export function syncColonySupply(
  state: PlanetState,
  colonyIndex: number,
  tick: number,
  data?: CompiledDataLike,
  opts: SupplyReadOpts = {},
): ColonySupply | undefined {
  const col = state.colonies[colonyIndex];
  if (!col) return undefined;
  const next = computeColonySupply(state, colonyIndex, data, opts);
  if (!sameSupply(col.supply as ColonySupply | undefined, next)) {
    col.supply = next;
    col.changedAt = tick;
  }
  return next;
}

/** Recomputes every colony's supply. */
export function syncAllColonySupply(state: PlanetState, tick: number, data?: CompiledDataLike): void {
  for (const col of state.colonies) if (col) syncColonySupply(state, col.index, tick, data);
}

/** Lifecycle slot: after units moved / died (5), buildings finished (6), power shed (7) and factories spawned (9). */
export const supplySystem = defineSystem({
  id: 'supply.sync',
  slot: 13,
  wave: 'W01',
  run(state, ctx) {
    syncAllColonySupply(state, ctx.tick, ctx.data);
  },
});

export default defineSimModule({
  id: 'supply',
  wave: 'W01',
  systems: [supplySystem],
});
