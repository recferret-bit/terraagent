import type { RejectCode } from '@terra/contracts';
import { dataRow, type CompiledRow } from '../../data';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { rowOf } from '../../ecs/store';
import { hexIndex } from '../../grid/hex';
import { PREP, TERRAIN } from '../../grid/layers';
import { isValidTileIndex } from '../../grid/tileModel';
import type { CompiledDataLike } from '../../kernel/config';
import type { SimState } from '../../kernel/state';
import { defaultW01Data } from '../hq';

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
  footprint?: number;
  allowUnclaimed?: boolean;
  data?: CompiledDataLike;
}

export interface ValidateHubPlacementResult {
  ok: boolean;
  reason?: RejectCode;
  tiles: FootprintTileInfo[];
  unpreparedCount: number;
  preparedCount: number;
}

/** Looks up the Command Hub T1 balance row (`hub.t1`). */
export function resolveHubT1Row(data?: CompiledDataLike): CompiledRow {
  const table = data?.tables.hub as Record<string, CompiledRow> | undefined;
  if (table?.t1) return table.t1;
  return dataRow(defaultW01Data(), 'hub', 't1');
}

/** Returns `true` when `buildingKind` refers to a Command Hub (`'commandHub' | 'hub' | 'hub.t1' | 'building.commandHub'`). */
export function isHubBuildingKind(buildingKind?: string): boolean {
  if (!buildingKind) return true;
  const normalized = buildingKind.trim().toLowerCase();
  return (
    normalized === 'hub' ||
    normalized === 'commandhub' ||
    normalized === 'command_hub' ||
    normalized === 'hub.t1' ||
    normalized === 'building.commandhub'
  );
}

/**
 * Returns the axial coordinates covered by an `N × N` footprint anchored at `(q, r)`.
 * For `footprint = 3` (Command Hub T1), returns the 9 tiles `(q + dq, r + dr)` with `dq, dr ∈ [-1, 0, 1]`.
 */
export function getBuildingFootprintTiles(
  q: number,
  r: number,
  footprint = 3,
): Array<{ q: number; r: number }> {
  const size = Math.max(1, Math.trunc(footprint));
  const minOff = -Math.floor((size - 1) / 2);
  const maxOff = minOff + size - 1;
  const out: Array<{ q: number; r: number }> = [];
  for (let dr = minOff; dr <= maxOff; dr++) {
    for (let dq = minOff; dq <= maxOff; dq++) {
      out.push({ q: q + dq, r: r + dr });
    }
  }
  return out;
}

/** Convenience helper returning the 3×3 Command Hub footprint centered at `(q, r)`. */
export function getHubFootprintTiles(q: number, r: number): Array<{ q: number; r: number }> {
  return getBuildingFootprintTiles(q, r, 3);
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

function isTileBuildableOrPreparableInW01(terrain: number, prep: number): {
  valid: boolean;
  prepared: boolean;
} {
  if (terrain === TERRAIN.deep || prep === PREP.ridge || prep === PREP.moat) {
    return { valid: false, prepared: false };
  }
  if (prep === PREP.prepared || prep === PREP.living) {
    return { valid: true, prepared: true };
  }
  if (terrain === TERRAIN.flat || terrain === TERRAIN.forest || terrain === TERRAIN.rock) {
    return { valid: true, prepared: false };
  }
  return { valid: false, prepared: false };
}

function collectExistingBuildingTileIndices(state: SimState): Set<number> {
  const occupied = new Set<number>();
  const e = state.entities;
  const cols = e.cols;
  const idx = hexIndex(state.grid.radius);
  for (let row = 0; row < e.count; row++) {
    if (cols.kind[row] < ENTITY_KIND.hub) continue;
    if (cols.hpMax[row] > 0 && cols.hp[row] <= 0) continue;
    const fpSize = cols.kind[row] === ENTITY_KIND.hub ? 3 : 1;
    for (const pos of getBuildingFootprintTiles(cols.q[row], cols.r[row], fpSize)) {
      const tIdx = idx.indexOf(pos.q, pos.r);
      if (tIdx >= 0) occupied.add(tIdx);
    }
  }
  return occupied;
}

function validateBuilderEntity(
  state: SimState,
  colonyId: number,
  builderEntityId: number | undefined,
  hqOnly: boolean,
): RejectCode | null {
  const e = state.entities;
  const cols = e.cols;
  if (builderEntityId !== undefined) {
    const row = rowOf(e, builderEntityId);
    if (row < 0 || (cols.hpMax[row] > 0 && cols.hp[row] <= 0)) {
      return 'unknown_entity';
    }
    if (cols.owner[row] !== colonyId) {
      return 'not_own_colony';
    }
    if (cols.state[row] === ENTITY_STATE.descending) {
      return 'worker_tier_locked';
    }
    if (hqOnly && cols.kind[row] !== ENTITY_KIND.hq) {
      return 'worker_tier_locked';
    }
    return null;
  }
  if (hqOnly && findAliveColonyHqRow(state, colonyId) < 0) {
    return 'worker_tier_locked';
  }
  return null;
}

function normalizeValidateOpts(
  optsOrColonyId: ValidateHubPlacementOpts | number,
  qArg?: number,
  rArg?: number,
  extraOpts?: Omit<ValidateHubPlacementOpts, 'colonyId' | 'q' | 'r'>,
): ValidateHubPlacementOpts {
  if (typeof optsOrColonyId === 'number') {
    return {
      colonyId: optsOrColonyId,
      q: qArg ?? NaN,
      r: rArg ?? NaN,
      ...extraOpts,
    };
  }
  return optsOrColonyId;
}

/**
 * Validates building placement at `(q, r)` (`UO-TF-01`, `UO-TF-05`, `UO-L-03`).
 * For Command Hub (`hub.t1`), enforces 3×3 footprint inside the map, no foreign-owned tiles,
 * unclaimed tiles allowed (`UO-TF-05`), no Deep Water or unpreparable terrain, max 1 Hub per colony, and HQ-only.
 */
export function validateBuildingPlacement(
  state: SimState,
  opts: ValidateHubPlacementOpts,
): ValidateHubPlacementResult {
  const { colonyId, q, r, builderEntityId, buildingKind, tier, data } = opts;
  if (!Number.isInteger(colonyId) || colonyId < 0 || !Number.isInteger(q) || !Number.isInteger(r)) {
    return { ok: false, reason: 'invalid_args', tiles: [], unpreparedCount: 0, preparedCount: 0 };
  }
  if (tier !== undefined && (!Number.isInteger(tier) || tier < 1 || tier > 3)) {
    return { ok: false, reason: 'invalid_args', tiles: [], unpreparedCount: 0, preparedCount: 0 };
  }
  if (tier !== undefined && tier > 1) {
    return { ok: false, reason: 'tier_locked', tiles: [], unpreparedCount: 0, preparedCount: 0 };
  }

  const isHub = isHubBuildingKind(buildingKind);
  const hubRow = resolveHubT1Row(data);
  const footprint = opts.footprint ?? (isHub ? Number(hubRow.footprintW ?? hubRow.footprint ?? 3) : 1);
  const allowUnclaimed = opts.allowUnclaimed ?? (isHub && Boolean(hubRow.allowUnclaimedPlacement ?? true));
  const hqOnly = isHub && Boolean(hubRow.hqOnly ?? true);

  if (builderEntityId !== undefined) {
    const builderErr = validateBuilderEntity(state, colonyId, builderEntityId, hqOnly);
    if (builderErr) {
      return { ok: false, reason: builderErr, tiles: [], unpreparedCount: 0, preparedCount: 0 };
    }
  }

  const hex = hexIndex(state.grid.radius);
  const coords = getBuildingFootprintTiles(q, r, footprint);
  const tiles: FootprintTileInfo[] = [];
  let unpreparedCount = 0;
  let preparedCount = 0;

  for (const pos of coords) {
    const tileIdx = hex.indexOf(pos.q, pos.r);
    if (tileIdx < 0 || !isValidTileIndex(state.grid, tileIdx)) {
      return { ok: false, reason: 'site_blocked', tiles, unpreparedCount, preparedCount };
    }
    const terrain = state.grid.layers.terrain[tileIdx];
    const prep = state.grid.layers.prep[tileIdx];
    const owner = state.grid.layers.owner[tileIdx];
    const check = isTileBuildableOrPreparableInW01(terrain, prep);
    if (check.prepared) preparedCount++;
    else unpreparedCount++;
    tiles.push({ q: pos.q, r: pos.r, tileIdx, terrain, prep, owner, prepared: check.prepared });
  }

  for (const tile of tiles) {
    if (tile.owner >= 0 && tile.owner !== colonyId) {
      return { ok: false, reason: 'not_own_territory', tiles, unpreparedCount, preparedCount };
    }
    if (tile.owner === -1 && !allowUnclaimed) {
      return { ok: false, reason: 'not_own_territory', tiles, unpreparedCount, preparedCount };
    }
  }

  const occupied = collectExistingBuildingTileIndices(state);
  for (const tile of tiles) {
    const check = isTileBuildableOrPreparableInW01(tile.terrain, tile.prep);
    if (!check.valid || occupied.has(tile.tileIdx)) {
      return { ok: false, reason: 'site_blocked', tiles, unpreparedCount, preparedCount };
    }
  }

  if (isHub && hasColonyHub(state, colonyId)) {
    return { ok: false, reason: 'site_blocked', tiles, unpreparedCount, preparedCount };
  }

  const builderErr = validateBuilderEntity(state, colonyId, builderEntityId, hqOnly);
  if (builderErr) {
    return { ok: false, reason: builderErr, tiles, unpreparedCount, preparedCount };
  }

  return { ok: true, tiles, unpreparedCount, preparedCount };
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
  const opts = normalizeValidateOpts(optsOrColonyId, qArg, rArg, extraOpts);
  return validateBuildingPlacement(state, {
    ...opts,
    buildingKind: opts.buildingKind ?? 'commandHub',
  });
}
