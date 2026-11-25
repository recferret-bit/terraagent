import { GEO_BLOCK_TEXT, geoBuildBlock, type GeoBlock, type GeoBuildOptions } from '../../grid/geo';
import { DEPOSIT } from '../../grid/layers';
import type { CompiledDataLike } from '../../kernel/config';
import type { PlanetState } from '../../kernel/state';
import { occupiedGroundTiles } from '../construction/occupancy';
import { evaluatePlacement, resolvePlacementRule, type PlacementBlock } from '../construction/placement';
import { placementWorldFromState } from '../construction/placementWorld';
import { getWreckTileSet } from '../combat/wrecks';
import { getFootprintTileIndices, resolveBuildingRow } from './construction';

/**
 * Terrain rule for a footprint with no placement row (D-37). Flat ground is a foundation.
 * Trees, rock, slope, hole, water, ridge, moat and resource deposits reject. Linked prep does not make them placeable.
 * Resource deposits for extractors live on their placement rows (checked via `evaluatePlacement`).
 */
export function footprintTerrainBlock(
  state: PlanetState,
  indices: readonly number[],
  _data?: CompiledDataLike,
  _colonyId?: number,
  geo: GeoBuildOptions = { linkedPrep: false },
): { block: GeoBlock; text: string } | null {
  const { terrain, prep, deposit } = state.grid.layers;
  const strict: GeoBuildOptions = { ...geo, linkedPrep: false };
  for (const i of indices) {
    const block = geoBuildBlock(terrain[i], prep[i], deposit?.[i] ?? DEPOSIT.none, 'forbid', strict);
    if (block) return { block, text: GEO_BLOCK_TEXT[block] };
  }
  return null;
}

/**
 * Input check of a `build` task (D-37): the reject (code + text) when its site can never take the building, or `null`.
 * A known row runs `evaluatePlacement`. A site that only waits (another building stands there, which a demolish frees)
 * is accepted and waits `site`. Unknown buildings are not rejected here.
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


/** The build path's own words for two blocks (queue `waiting: site (…)` texts and tests read them). */
const SITE_DETAIL: Partial<Record<PlacementBlock, string>> = { occupied: 'tile occupied', noDeposit: 'no deposit' };

/**
 * Site check of a build (D-37): a known row (Hub or not) runs the shared `evaluatePlacement` (map, territory, other
 * buildings, terrain, deposits, uneven ground). Flat ground is a foundation; obstacles are not. An unknown building
 * falls back to the terrain check with linked prep off, so obstacles still reject. `null` = ok.
 */
export function buildingSiteBlock(
  state: PlanetState,
  site: { owner: number; building: string; q: number; r: number },
  fpIndices: readonly number[],
  data?: CompiledDataLike,
): { code: string; detail?: string } | null {
  const rule = resolvePlacementRule(site.building, data);
  if (rule) {
    const res = evaluatePlacement(placementWorldFromState(state), { colonyId: site.owner, building: site.building, q: site.q, r: site.r, requireBuilder: false, data });
    if (res.ok) return null;
    return { code: res.code ?? 'site_blocked', detail: (res.block && SITE_DETAIL[res.block]) ?? res.text };
  }
  const occupied = occupiedGroundTiles(state, data); // buildings, not `anchors` (territory claim count)
  const wrecks = getWreckTileSet(state);
  const geo: GeoBuildOptions = { linkedPrep: false };
  for (const tileIdx of fpIndices) {
    if (wrecks.has(tileIdx)) return { code: 'terrain_unbuildable', detail: 'wreckage: terraform to clear' };
    const tb = footprintTerrainBlock(state, [tileIdx], data, site.owner, geo);
    if (tb) return { code: 'terrain_unbuildable', detail: tb.text };
    if (occupied.has(tileIdx)) return { code: 'site_blocked', detail: 'tile occupied' };
  }
  return null;
}
