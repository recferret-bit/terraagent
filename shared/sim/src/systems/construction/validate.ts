import type { RejectCode } from '@terra/contracts';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { getColonyStock } from '../../economy';
import type { CompiledDataLike } from '../../kernel/config';
import type { SimState } from '../../kernel/state';
import { evaluatePlacement, resolveHubT1Row, type PlacementBlock, type PlacementResult } from './placement';
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
  checkResources?: boolean;
}

export interface BuildingAffordabilityResult {
  ok: boolean;
  shortResource?: string;
  have: number;
  need: number;
}

/**
 * Checks whether `stock` meets the required `cost`.
 * Prioritizes metals -> minerals -> biomass -> water -> others.
 */
export function checkBuildingAffordability(
  cost: Record<string, number>,
  stock: Record<string, number> | undefined,
): BuildingAffordabilityResult {
  const stockMap = stock ?? {};
  const orderRank = (k: string): number => {
    if (k.startsWith('metals')) return 0;
    if (k.startsWith('minerals')) return 1;
    if (k.includes('biomass')) return 2;
    if (k.includes('water')) return 3;
    return 4;
  };
  const keys = Object.keys(cost).sort((a, b) => orderRank(a) - orderRank(b));
  for (const key of keys) {
    const need = cost[key] ?? 0;
    const have = stockMap[key] ?? 0;
    if (have < need) {
      return { ok: false, shortResource: key, have, need };
    }
  }
  return { ok: true, have: 0, need: 0 };
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

/** Convenience helper returning the 3×3 Command Hub footprint centered at `(q, r)`. */
export function getHubFootprintTiles(q: number, r: number): Array<{ q: number; r: number }> {
  const out: Array<{ q: number; r: number }> = [];
  for (let dr = -1; dr <= 1; dr++) for (let dq = -1; dq <= 1; dq++) out.push({ q: q + dq, r: r + dr });
  return out;
}

/** Returns `true` if `colonyId` already has an alive or pending Command Hub entity (`maxPerColony: 1`). */
export function hasColonyHub(state: SimState, colonyId: number): boolean {
  const e = state.entities;
  const cols = e.cols;
  for (let row = 0; row < e.count; row++) {
    if (cols.kind[row] !== ENTITY_KIND.hub) continue;
    if (cols.owner[row] !== colonyId) continue;
    if (cols.hpMax[row] > 0 && cols.hp[row] <= 0) continue;
    return true;
  }
  return false;
}

/** Returns the row index of an alive, landed HQ unit belonging to `colonyId`, or `-1` if none exists. */
export function findAliveColonyHqRow(state: SimState, colonyId: number): number {
  const e = state.entities;
  const cols = e.cols;
  for (let row = 0; row < e.count; row++) {
    if (cols.kind[row] !== ENTITY_KIND.hq) continue;
    if (cols.owner[row] !== colonyId) continue;
    if (cols.hpMax[row] > 0 && cols.hp[row] <= 0) continue;
    if (cols.state[row] === ENTITY_STATE.descending) continue;
    return row;
  }
  return -1;
}

/**
 * Authoritative placement check used by the `placeBuilding` handler: adapts `state` into a `PlacementWorld` and runs the
 * shared `evaluatePlacement` (the very function the client ghost runs on its replica), plus the optional stock check.
 */
export function validateBuildingPlacement(state: SimState, opts: ValidateHubPlacementOpts): ValidateHubPlacementResult {
  const placement = evaluatePlacement(placementWorldFromState(state), {
    colonyId: opts.colonyId,
    q: opts.q,
    r: opts.r,
    building: opts.buildingKind,
    tier: opts.tier,
    builderEntityId: opts.builderEntityId,
    data: opts.data,
  });
  const tiles: FootprintTileInfo[] = placement.tiles
    .filter((t) => t.block !== 'outOfMap')
    .map((t) => ({ q: t.q, r: t.r, tileIdx: t.tileIdx, terrain: t.terrain, prep: t.prep, owner: t.owner, prepared: t.prepared }));
  const base = { tiles, unpreparedCount: placement.unpreparedCount, preparedCount: placement.preparedCount, placement };
  if (!placement.ok) return { ok: false, reason: placement.code, block: placement.block, ...base };
  if (opts.checkResources) {
    const cost = resolveHubT1Row(opts.data).cost as Record<string, number> | undefined;
    if (cost && !checkBuildingAffordability(cost, getColonyStock(state, opts.colonyId)).ok) {
      return { ok: false, reason: 'insufficient_resources', ...base };
    }
  }
  return { ok: true, ...base };
}

/**
 * Validates Command Hub 3×3 placement at `(q, r)` (`UO-TF-05`, `UO-L-03`, `W01-14`).
 * Supports both `validateHubPlacement(state, { colonyId, q, r, ... })` and `validateHubPlacement(state, colonyId, q, r, extraOpts)`.
 */
export function validateHubPlacement(
  state: SimState,
  optsOrColonyId: ValidateHubPlacementOpts | number,
  qArg?: number,
  rArg?: number,
  extraOpts?: Omit<ValidateHubPlacementOpts, 'colonyId' | 'q' | 'r'>,
): ValidateHubPlacementResult {
  const opts: ValidateHubPlacementOpts =
    typeof optsOrColonyId === 'number' ? { colonyId: optsOrColonyId, q: qArg ?? NaN, r: rArg ?? NaN, ...extraOpts } : optsOrColonyId;
  return validateBuildingPlacement(state, { ...opts, buildingKind: opts.buildingKind ?? 'commandHub' });
}
