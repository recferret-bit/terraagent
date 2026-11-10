import { T1_RESOURCE_KEYS, type BountyTarget } from '@terra/contracts';
import {
  ENTITY_KIND,
  checkGridTileExplored,
  hexIndex,
  rowOf,
  type PlanetState,
  type TileLayersLike,
} from '@terra/sim';
import type { BountyScreen } from './validate.js';

const HIVE_KINDS: ReadonlySet<number> = new Set([
  ENTITY_KIND.hiveBlackAnt,
  ENTITY_KIND.hiveBlueBeetle,
  ENTITY_KIND.hiveGreenSpitter,
]);
const T1: ReadonlySet<string> = new Set(T1_RESOURCE_KEYS);

const UNSEEN: BountyScreen = { code: 'invalid_target', detail: 'Nest is not visible' };
const OUTSIDE: BountyScreen = { code: 'not_own_territory', detail: 'Area is outside your territory' };

/**
 * Target rule for a post. A `clear_nest` must be a living hive on a tile this colony has explored.
 * `defend_area` must sit on the colony's territory. `deliver_units` is amount and Tier-1 only.
 */
export function screenTarget(state: PlanetState | null, colonyIndex: number, target: BountyTarget): BountyScreen | null {
  if (target.kind === 'deliver_units') return screenDeliver(target.resource, target.amount);
  if (target.kind === 'defend_area') return screenArea(state, colonyIndex, target.q, target.r);
  return screenNest(state, colonyIndex, target.nestId);
}

function screenDeliver(resource: string, amount: number): BountyScreen | null {
  if (amount > 0 && T1.has(resource)) return null;
  return { code: 'invalid_args', detail: 'Deliver amount must be a positive Tier-1 quantity' };
}

function screenArea(state: PlanetState | null, colonyIndex: number, q: number, r: number): BountyScreen | null {
  if (!state || tileOwner(state, q, r) !== colonyIndex) return OUTSIDE;
  return null;
}

function screenNest(state: PlanetState | null, colonyIndex: number, nestId: string): BountyScreen | null {
  const nest = state ? hiveTile(state, nestId) : null;
  if (!nest || !tileExplored(state!, colonyIndex, nest.q, nest.r)) return UNSEEN;
  return null;
}

function hiveTile(state: PlanetState, nestId: string): { q: number; r: number } | null {
  if (!/^\d+$/.test(nestId)) return null;
  const id = Number(nestId);
  if (!Number.isSafeInteger(id)) return null;
  const row = rowOf(state.entities, id);
  if (row < 0) return null;
  const cols = state.entities.cols;
  if (!HIVE_KINDS.has(cols.kind[row] ?? -1)) return null;
  if ((cols.hpMax[row] ?? 0) > 0 && (cols.hp[row] ?? 0) <= 0) return null;
  return { q: cols.q[row] ?? 0, r: cols.r[row] ?? 0 };
}

function tileExplored(state: PlanetState, colonyIndex: number, q: number, r: number): boolean {
  const tile = hexIndex(state.grid.radius).indexOf(q, r);
  if (tile < 0) return false;
  return checkGridTileExplored(state.grid.layers as TileLayersLike, state.grid.count, tile, colonyIndex);
}

function tileOwner(state: PlanetState, q: number, r: number): number {
  const tile = hexIndex(state.grid.radius).indexOf(q, r);
  if (tile < 0) return -1;
  const owner = state.grid.layers.owner;
  return owner ? (owner[tile] ?? -1) : -1;
}
