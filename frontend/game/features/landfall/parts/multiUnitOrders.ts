import {
  DEPOSIT,
  ENTITY_KIND,
  ENTITY_STATE,
  HEX_DIRS,
  PREP,
  TERRAIN,
  getWreckTileSet,
  globalTileToSector,
  hexIndex,
  isGroundMoveBlocked,
  isPassableTerrain,
  isPreparedGround,
  movementProfile,
  ringCoords,
  type CompiledDataLike,
} from '@terra/sim';
import { collectEntitiesFromView, isEntityAlive } from '../../army/parts/armyEntityQueries';
import type { SelectionCombatSummary } from '../HqPanel';
import type { SelectedEntityView } from '../selection';
import { inspectDepositAt, isArmyCombatUnitKind, resolveTileIndex } from '../selectionHelpers';

export interface SmartUnitMoveOptions {
  readonly unitIds: readonly number[];
  readonly q: number;
  readonly r: number;
  readonly view: unknown;
  readonly fallbackTiles?: unknown;
  readonly simData?: CompiledDataLike | null;
  readonly ownerColonyIndex: number;
  readonly isBlockedByBuilding?: (q: number, r: number) => boolean;
  readonly onResolvedTarget?: (q: number, r: number) => void;
  readonly send: (kind: string, args: Record<string, unknown>) => void;
}

function readTileAt(
  rawView: unknown,
  fallbackTiles: unknown,
  q: number,
  r: number,
): { hasLayers: boolean; idx: number; terrain: number; prep: number; deposit: number } | null {
  const v = (rawView && typeof rawView === 'object' ? rawView : {}) as Record<string, unknown>;
  const tiles = (v.tiles ?? fallbackTiles) as Record<string, unknown> | undefined;
  const planetRadius = (v.planet as { radius?: number } | undefined)?.radius;
  if (!tiles || typeof tiles !== 'object') {
    if (typeof planetRadius === 'number' && planetRadius >= 0 && hexIndex(planetRadius).indexOf(q, r) < 0) {
      return null;
    }
    return { hasLayers: false, idx: -1, terrain: TERRAIN.flat, prep: PREP.wild, deposit: DEPOSIT.none };
  }
  const idx = resolveTileIndex(tiles, planetRadius, q, r);
  if (idx < 0) return null;
  const terrainArr = tiles.terrain as ArrayLike<number> | undefined;
  const prepArr = tiles.prep as ArrayLike<number> | undefined;
  const depositArr = tiles.deposit as ArrayLike<number> | undefined;
  if (!terrainArr) {
    return { hasLayers: false, idx, terrain: TERRAIN.flat, prep: PREP.wild, deposit: DEPOSIT.none };
  }
  return {
    hasLayers: true,
    idx,
    terrain: Number(terrainArr[idx] ?? TERRAIN.flat),
    prep: Number(prepArr?.[idx] ?? PREP.wild),
    deposit: Number(depositArr?.[idx] ?? DEPOSIT.none),
  };
}

export function isUniversalImpassableTile(
  rawView: unknown,
  fallbackTiles: unknown,
  q: number,
  r: number,
  isBlockedByBuilding?: (q: number, r: number) => boolean,
): boolean {
  if (!Number.isFinite(q) || !Number.isFinite(r)) return true;
  if (isBlockedByBuilding?.(q, r)) return true;
  const info = readTileAt(rawView, fallbackTiles, q, r);
  if (!info) return true;
  const wrecks = getWreckTileSet(rawView as Record<string, unknown> | undefined);
  if (info.idx >= 0 && wrecks.has(info.idx)) return true;
  if (!info.hasLayers) return false;
  if (!isPassableTerrain(info.terrain, info.prep)) return true;
  if (info.terrain === TERRAIN.rock && !isPreparedGround(info.prep)) return true;
  return false;
}

function isTilePassableForProfile(
  info: NonNullable<ReturnType<typeof readTileAt>>,
  profile: string,
): boolean {
  if (!info.hasLayers) return true;
  if (!isPassableTerrain(info.terrain, info.prep)) return false;
  if (info.terrain === TERRAIN.rock && !isPreparedGround(info.prep)) return false;
  if (profile === 'hover') return true;
  if (profile === 'worker') return info.terrain !== TERRAIN.shallow && info.deposit === DEPOSIT.none;
  return !isGroundMoveBlocked(info.terrain, info.deposit);
}

function collectStationaryOccupiedHexes(
  rawView: unknown,
  ownerColonyIndex: number,
  excludeIds: ReadonlySet<number>,
): { all: Set<string>; friendly: Set<string>; hostile: Set<string> } {
  const all = new Set<string>();
  const friendly = new Set<string>();
  const hostile = new Set<string>();
  const rows = collectEntitiesFromView(rawView, ownerColonyIndex);
  for (const row of rows) {
    if (!isEntityAlive(row) || excludeIds.has(row.id)) continue;
    if (row.kind === ENTITY_KIND.pod) continue;
    if (row.state === ENTITY_STATE.moving) continue;
    const key = `${Math.round(row.q)},${Math.round(row.r)}`;
    all.add(key);
    if (row.owner === ownerColonyIndex) friendly.add(key);
    else hostile.add(key);
  }
  return { all, friendly, hostile };
}

function resolveViewSectorRadius(rawView: unknown): number {
  if (!rawView || typeof rawView !== 'object') return 0;
  const blobs = (rawView as { blobs?: Record<string, unknown> }).blobs;
  const rawAtlas = blobs?.atlas as { value?: unknown } | undefined;
  const atlas = (rawAtlas && typeof rawAtlas === 'object' && 'value' in rawAtlas ? rawAtlas.value : rawAtlas) as
    | { sectorRadius?: unknown }
    | undefined;
  const sr = Number(atlas?.sectorRadius ?? 0);
  return Number.isFinite(sr) && sr > 0 ? sr : 0;
}

function resolveClientUnitProfile(kind: number | undefined, simData?: CompiledDataLike | null): string {
  if (kind !== undefined && simData) return movementProfile(kind, simData);
  if (kind === ENTITY_KIND.hq) return 'hover';
  if (kind === ENTITY_KIND.worker) return 'worker';
  return 'ground';
}

function findFreeStandHexNear(
  q: number,
  r: number,
  profile: string,
  taken: Set<string>,
  rawView: unknown,
  fallbackTiles: unknown,
  isBlockedByBuilding?: (tq: number, tr: number) => boolean,
  allowedSectorId?: string | null,
  sectorRadius = 0,
): { q: number; r: number } | null {
  const wrecks = getWreckTileSet(rawView as Record<string, unknown> | undefined);
  for (let ring = 0; ring <= 4; ring++) {
    for (const [cq, cr] of ringCoords(q, r, ring)) {
      if (allowedSectorId && sectorRadius > 0 && globalTileToSector(cq, cr, sectorRadius).sectorId !== allowedSectorId) {
        continue;
      }
      const key = `${cq},${cr}`;
      if (taken.has(key) || isBlockedByBuilding?.(cq, cr)) continue;
      const info = readTileAt(rawView, fallbackTiles, cq, cr);
      if (!info || (info.idx >= 0 && wrecks.has(info.idx))) continue;
      if (!isTilePassableForProfile(info, profile)) continue;
      taken.add(key);
      return { q: cq, r: cr };
    }
  }
  return null;
}

function dispatchSingleUnitMove(
  entityId: number,
  unitRow: { q: number; r: number; kind: number } | undefined,
  tileInfo: NonNullable<ReturnType<typeof readTileAt>>,
  sectorRadius: number,
  occ: { all: Set<string>; friendly: Set<string>; hostile: Set<string> },
  opts: SmartUnitMoveOptions,
): boolean {
  const { q, r, view, fallbackTiles, simData, isBlockedByBuilding, send } = opts;
  const profile = resolveClientUnitProfile(unitRow?.kind, simData);
  const unitSectorId =
    sectorRadius > 0 && unitRow
      ? globalTileToSector(Math.round(unitRow.q), Math.round(unitRow.r), sectorRadius).sectorId
      : null;
  if (unitSectorId && globalTileToSector(q, r, sectorRadius).sectorId !== unitSectorId) return false;
  const targetKey = `${q},${r}`;
  if (occ.hostile.has(targetKey)) return false;
  if (occ.friendly.has(targetKey) || occ.all.has(targetKey)) {
    const taken = new Set(occ.all);
    taken.add(targetKey);
    const slot = findFreeStandHexNear(q, r, profile, taken, view, fallbackTiles, isBlockedByBuilding, unitSectorId, sectorRadius);
    if (!slot) return false;
    send('moveUnit', { entityId, q: slot.q, r: slot.r });
    opts.onResolvedTarget?.(slot.q, slot.r);
    return true;
  }
  if (!isTilePassableForProfile(tileInfo, profile)) return false;
  send('moveUnit', { entityId, q, r });
  opts.onResolvedTarget?.(q, r);
  return true;
}

/**
 * Dispatches non-overlapping unit move orders:
 * - Deposit targets send eligible harvesters (`worker` / `hq`) via `moveUnit` so the sim assigns distinct adjacent hexes.
 * - Single-unit moves reject tiles occupied by stationary units/buildings/wrecks and dispatch `moveUnit`.
 * - Multi-unit moves group units by `movementProfile` and dispatch `moveGroup` (for groups of `>= 2`) plus non-overlapping
 *   `moveUnit` offsets for any singleton profile leftovers so no two units share a destination hex.
 */
export function dispatchSmartUnitMove(opts: SmartUnitMoveOptions): boolean {
  const { unitIds, q, r, view, fallbackTiles, simData, ownerColonyIndex, isBlockedByBuilding, send } = opts;
  const uniqueIds = [...new Set(unitIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (uniqueIds.length === 0 || !Number.isInteger(q) || !Number.isInteger(r)) return false;
  if (isBlockedByBuilding?.(q, r)) return false;

  const tileInfo = readTileAt(view, fallbackTiles, q, r);
  if (!tileInfo) return false;
  const wrecks = getWreckTileSet(view as Record<string, unknown> | undefined);
  if (tileInfo.idx >= 0 && wrecks.has(tileInfo.idx)) return false;
  if (tileInfo.hasLayers && (!isPassableTerrain(tileInfo.terrain, tileInfo.prep) || (tileInfo.terrain === TERRAIN.rock && !isPreparedGround(tileInfo.prep)))) {
    return false;
  }

  const rows = collectEntitiesFromView(view, ownerColonyIndex);
  const byId = new Map(rows.map((row) => [row.id, row]));

  const dep = inspectDepositAt(view, fallbackTiles, q, r);
  if (dep && dep.deposit > 0) {
    const harvesters = uniqueIds.filter((id) => {
      const k = byId.get(id)?.kind;
      return k === ENTITY_KIND.worker || k === ENTITY_KIND.hq;
    });
    if (harvesters.length === 0) return false;
    const hasAdj = HEX_DIRS.some(([dq, dr]) => !isUniversalImpassableTile(view, fallbackTiles, q + dq, r + dr, isBlockedByBuilding));
    if (!hasAdj) return false;
    for (const entityId of harvesters) {
      send('moveUnit', { entityId, q, r });
    }
    opts.onResolvedTarget?.(q, r);
    return true;
  }

  const occ = collectStationaryOccupiedHexes(view, ownerColonyIndex, new Set(uniqueIds));
  const sectorRadius = resolveViewSectorRadius(view);
  if (uniqueIds.length === 1) {
    return dispatchSingleUnitMove(uniqueIds[0]!, byId.get(uniqueIds[0]!), tileInfo, sectorRadius, occ, opts);
  }

  const byProfile = new Map<string, number[]>();
  for (const id of uniqueIds) {
    const profile = resolveClientUnitProfile(byId.get(id)?.kind, simData);
    const list = byProfile.get(profile);
    if (list) list.push(id);
    else byProfile.set(profile, [id]);
  }

  const taken = new Set(occ.all);
  let dispatched = false;
  let resolvedQ = q;
  let resolvedR = r;
  for (const [profile, group] of byProfile) {
    if (group.length >= 2) {
      if (!isTilePassableForProfile(tileInfo, profile) && tileInfo.terrain === TERRAIN.deep) continue;
      send('moveGroup', { entityIds: group, q, r });
      taken.add(`${q},${r}`);
      dispatched = true;
    } else if (group.length === 1) {
      const singletonRow = byId.get(group[0]!);
      const singletonSectorId =
        sectorRadius > 0 && singletonRow
          ? globalTileToSector(Math.round(singletonRow.q), Math.round(singletonRow.r), sectorRadius).sectorId
          : null;
      const slot = findFreeStandHexNear(q, r, profile, taken, view, fallbackTiles, isBlockedByBuilding, singletonSectorId, sectorRadius);
      if (slot) {
        send('moveUnit', { entityId: group[0]!, q: slot.q, r: slot.r });
        if (!dispatched) {
          resolvedQ = slot.q;
          resolvedR = slot.r;
        }
        dispatched = true;
      }
    }
  }
  if (dispatched) opts.onResolvedTarget?.(resolvedQ, resolvedR);
  return dispatched;
}

export function summarizeSelectedMultiUnits(entities: readonly SelectedEntityView[]): SelectionCombatSummary | null {
  if (entities.length <= 1) return null;
  let hp = 0;
  let hpMax = 0;
  const kinds = new Set<number>();
  for (const e of entities) {
    hp += e.hp;
    hpMax += e.hpMax;
    kinds.add(e.kind);
  }
  if (kinds.size === 1 && kinds.has(ENTITY_KIND.worker)) {
    return { count: entities.length, code: 'WRK', title: 'WORKER CREW', hp, hpMax };
  }
  const allCombat = entities.every((e) => isArmyCombatUnitKind(e.kind));
  return {
    count: entities.length,
    code: allCombat ? 'SQD' : 'UNT',
    title: allCombat ? 'COMBAT SQUAD' : 'UNIT GROUP',
    hp,
    hpMax,
  };
}
