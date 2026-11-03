import { GEO_BLOCK_TEXT, geoBuildBlock, type GeoBlock } from '../../grid/geo';
import { DEPOSIT } from '../../grid/layers';
import type { CompiledDataLike } from '../../kernel/config';
import type { PlanetState } from '../../kernel/state';
import { getFootprintTileIndices, resolveBuildingRow } from './construction';

/**
 * Terrain rule for every building (D-37): nothing is built on ground the player has not terraformed. Trees, rock, slope,
 * holes, water and ridges block until cleared / levelled; construction never converts them (it only Grades flat ground).
 * Resource deposits are allowed here (extractors stand on them; the deposit rule is the building row's).
 */
export function footprintTerrainBlock(state: PlanetState, indices: readonly number[]): { block: GeoBlock; text: string } | null {
  const { terrain, prep } = state.grid.layers;
  for (const i of indices) {
    const block = geoBuildBlock(terrain[i], prep[i], DEPOSIT.none, 'any');
    if (block) return { block, text: GEO_BLOCK_TEXT[block] };
  }
  return null;
}

/** Input check (D-37): the reason a `build` task's footprint stands on un-terraformed ground, or `null`. Unknown sites pass here (other checks refuse them). */
export function buildSiteTerrainBlock(state: PlanetState, task: { building: string; q: number; r: number; rotation?: number }, data?: CompiledDataLike): string | null {
  const res = resolveBuildingRow(task.building, data);
  if (!res) return null;
  const w = Number(res.row.footprintW ?? res.row.footprint ?? 2), d = Number(res.row.footprintD ?? res.row.footprint ?? 2);
  const fp = getFootprintTileIndices(state, task.q, task.r, w, d, task.rotation ?? 0);
  return fp.valid ? (footprintTerrainBlock(state, fp.indices)?.text ?? null) : null;
}

