import type { RejectCode } from '@terra/contracts';
import { ENTITY_KIND } from '../../ecs/columns';
import type { CompiledDataLike } from '../../kernel/config';
import type { SimState } from '../../kernel/state';
import { findColonyEntityRow } from '../find';
import { entityFootprint, evaluatePlacement, getBuildingFootprintTiles, type PlacementBlock, type PlacementResult } from './placement';
import { placementWorldFromState } from './placementWorld';

export interface FootprintTileInfo {
  q: number;
  r: number;
  tileIdx: number;
  terrain: number;
  prep: number;
  owner: number;
  prepared: boolean;
}

export interface ValidateHubPlacementOpts {
  colonyId: number;
  q: number;
  r: number;
  builderEntityId?: number;
  buildingKind?: string;
  tier?: number;
  data?: CompiledDataLike;
}

export interface ValidateHubPlacementResult {
  ok: boolean;
  reason?: RejectCode;
  /** Machine cause behind `reason` (e.g. `trees`, `deposit`, `foreign`), shared with the client ghost. */
  block?: PlacementBlock;
  tiles: FootprintTileInfo[];
  unpreparedCount: number;
  preparedCount: number;
  placement: PlacementResult;
}

/** The Command Hub footprint centred at `(q, r)` (`getBuildingFootprintTiles` with the Hub row's footprint). */
export function getHubFootprintTiles(q: number, r: number, data?: CompiledDataLike): Array<{ q: number; r: number }> {
  return getBuildingFootprintTiles(q, r, entityFootprint(ENTITY_KIND.hub, data));
}

/** Returns `true` if `colonyId` already has an alive or pending Command Hub entity (`maxPerColony: 1`). */
export function hasColonyHub(state: SimState, colonyId: number): boolean {
  return findColonyEntityRow(state, colonyId, ENTITY_KIND.hub) >= 0;
}

/**
 * Authoritative placement check used by the `placeBuilding` handler: adapts `state` into a `PlacementWorld` and runs the
 * shared `evaluatePlacement` (the very function the client ghost runs on its replica).
 */
export function validateBuildingPlacement(state: SimState, opts: ValidateHubPlacementOpts): ValidateHubPlacementResult {
  const placement = evaluatePlacement(placementWorldFromState(state), {
    colonyId: opts.colonyId,
    q: opts.q,
    r: opts.r,
    building: opts.buildingKind,
    tier: opts.tier,
    builderEntityId: opts.builderEntityId,
    hubOnly: true, // W02 buildings are queued (`enqueueTask`), never built through `placeBuilding` (GP-05)
    data: opts.data,
  });
  const tiles: FootprintTileInfo[] = placement.tiles
    .filter((t) => t.block !== 'outOfMap')
    .map((t) => ({ q: t.q, r: t.r, tileIdx: t.tileIdx, terrain: t.terrain, prep: t.prep, owner: t.owner, prepared: t.prepared }));
  const base = { tiles, unpreparedCount: placement.unpreparedCount, preparedCount: placement.preparedCount, placement };
  return placement.ok ? { ok: true, ...base } : { ok: false, reason: placement.code, block: placement.block, ...base };
}
