import { ENTITY_KIND } from '../../ecs/columns';
import { rowOf } from '../../ecs/store';
import { hexIndex } from '../../grid/hex';
import { isTileExplored } from '../../grid/tileModel';
import type { CompiledDataLike } from '../../kernel/config';
import type { PlanetState } from '../../kernel/state';
import { computeColonySpottedTileIndices } from '../combat/vision';

/** W07 species hives. `nestId` is the hive entity id, not a catalog id (GP-119). */
const HIVE_KINDS: ReadonlySet<number> = new Set([
  ENTITY_KIND.hiveBlackAnt,
  ENTITY_KIND.hiveBlueBeetle,
  ENTITY_KIND.hiveGreenSpitter,
]);

/**
 * `invalid_target` unless `nestId` is a living species hive the poster has explored
 * or currently spots (W07 view). Does not write the vision cache (GP-121).
 */
export function clearNestTargetReject(
  state: PlanetState,
  colony: number,
  nestId: string,
  data?: CompiledDataLike,
): 'invalid_target' | null {
  const hive = livingHive(state, nestId);
  if (!hive || !colonySeesHive(state, colony, hive.q, hive.r, data)) return 'invalid_target';
  return null;
}

function livingHive(state: PlanetState, nestId: string): { q: number; r: number } | null {
  if (!/^\d+$/.test(nestId)) return null;
  const id = Number(nestId);
  if (!Number.isSafeInteger(id)) return null;
  const row = rowOf(state.entities, id);
  if (row < 0) return null;
  const cols = state.entities.cols;
  if (!HIVE_KINDS.has(cols.kind[row] ?? -1)) return null;
  if ((cols.hp[row] ?? 0) <= 0) return null;
  return { q: cols.q[row] ?? 0, r: cols.r[row] ?? 0 };
}

/** Explored anchor tile (W22-19) or a living unit's current view. Either one is enough. */
function colonySeesHive(state: PlanetState, colony: number, q: number, r: number, data?: CompiledDataLike): boolean {
  if (colony < 0) return false;
  const tile = hexIndex(state.grid.radius).indexOf(q, r);
  if (tile < 0) return false;
  if (isTileExplored(state.grid, tile, colony)) return true;
  return computeColonySpottedTileIndices(state, colony, data).has(tile);
}
