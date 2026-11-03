import { GEO_BLOCK_TEXT, geoBuildBlock, type GeoBlock } from '../../grid/geo';
import { DEPOSIT } from '../../grid/layers';
import type { CompiledDataLike } from '../../kernel/config';
import type { PlanetState } from '../../kernel/state';
import { occupiedGroundTiles } from '../construction/occupancy';
import { evaluatePlacement, resolvePlacementRule, type PlacementBlock } from '../construction/placement';
import { placementWorldFromState } from '../construction/placementWorld';
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

/**
 * Input check of a `build` task (D-37): the reject (code + text) when its site can never take the building, or `null`.
 * W02 rows run `evaluatePlacement` with the colony; a site that only waits (another building stands there, which a
 * demolish frees) is accepted and waits `site`. The Hub keeps the terrain-only check. Unknown sites pass here.
 */
export function buildSiteReject(
  state: PlanetState,
  colonyId: number,
  task: { building: string; q: number; r: number; rotation?: number },
  data?: CompiledDataLike,
): { code: string; detail?: string } | null {
  const res = resolveBuildingRow(task.building, data);
  if (!res) return null;
  const w = Number(res.row.footprintW ?? res.row.footprint ?? 2), d = Number(res.row.footprintD ?? res.row.footprint ?? 2);
  const fp = getFootprintTileIndices(state, task.q, task.r, w, d, task.rotation ?? 0);
  if (!fp.valid) return null;
  const block = buildingSiteBlock(state, { owner: colonyId, building: task.building, q: task.q, r: task.r }, fp.indices, data);
  return block && block.detail !== SITE_DETAIL.occupied ? block : null;
}


/** The W02 build path's own words for two blocks (queue `waiting: site (…)` texts and tests read them). */
const SITE_DETAIL: Partial<Record<PlacementBlock, string>> = { occupied: 'tile occupied', noDeposit: 'no deposit' };

/**
 * Site check of a W02 build (D-37): a W02 building row (Extractor, Solar) runs the shared `evaluatePlacement` (the rule
 * the `placeBuilding` handler and the Hub ghost use: map, foreign territory, other buildings, terrain, deposits, uneven
 * ground, the extractor's deposit); the Hub on this path keeps the footprint terrain + occupancy check. `null` = ok.
 */
export function buildingSiteBlock(
  state: PlanetState,
  site: { owner: number; building: string; q: number; r: number },
  fpIndices: readonly number[],
  data?: CompiledDataLike,
): { code: string; detail?: string } | null {
  const rule = resolvePlacementRule(site.building, data);
  if (rule && !rule.isHub) {
    const res = evaluatePlacement(placementWorldFromState(state), { colonyId: site.owner, building: site.building, q: site.q, r: site.r, requireBuilder: false, data });
    if (res.ok) return null;
    return { code: res.code ?? 'site_blocked', detail: (res.block && SITE_DETAIL[res.block]) ?? res.text };
  }
  const occupied = occupiedGroundTiles(state, data); // buildings, not `anchors` (territory claim count)
  for (const tileIdx of fpIndices) {
    const tb = footprintTerrainBlock(state, [tileIdx]);
    if (tb) return { code: 'terrain_unbuildable', detail: tb.text };
    if (occupied.has(tileIdx)) return { code: 'site_blocked', detail: 'tile occupied' };
  }
  return null;
}
