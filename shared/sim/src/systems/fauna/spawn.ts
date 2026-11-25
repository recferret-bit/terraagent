import { ENTITY_STATE } from '../../ecs/columns';
import { placeSpawnedEntity } from '../../ecs/placement';
import { insertRow, rowOf } from '../../ecs/store';
import { getWorldgenHiveSites, type PlanHiveSitesOptions, planWorldgenHiveSites } from '../../gen/world/stages/faunaHives';
import { isPreparedGround } from '../../grid/geo';
import { HEX_DIRS, hexDistance, hexIndex, inHex } from '../../grid/hex';
import { DEPOSIT, PREP, TERRAIN } from '../../grid/layers';
import { bumpPathEpoch, isGroundPassable } from '../../grid/tileModel';
import type { CompiledDataLike } from '../../kernel/config';
import type { PlanetState } from '../../kernel/state';
import { ringCoords } from '../../units/movement/slots';
import { collectUnitOccupancy } from '../../units/movement/unitOccupancy';
import { getWreckTileSet } from '../combat/wrecks';
import { occupiedGroundTiles } from '../construction/occupancy';
import {
  collectBlockedHiveTiles,
  findNearestHiveSpawnTile,
  HIVE_HEX_RADIUS,
  HIVE_PLANAR_RADIUS_DEFAULT,
  HIVE_PLANAR_RADIUS_DESERT,
  HIVE_TERRAFORM_RADIUS,
  type HiveSitePlacementOptions,
  isHiveSitePlaceable,
  isWithinHivePadOffset,
  terraformHiveGround,
} from './hiveGround';
import { getFaunaHivesState, saveFaunaHivesState } from './state';
import {
  defaultFaunaData,
  resolveSpeciesConfig,
  type FaunaSpeciesId,
  type HiveRecord,
  type ResidentBugRecord,
} from './types';

export {
  collectBlockedHiveTiles,
  findNearestHiveSpawnTile,
  HIVE_HEX_RADIUS,
  HIVE_PLANAR_RADIUS_DEFAULT,
  HIVE_PLANAR_RADIUS_DESERT,
  HIVE_TERRAFORM_RADIUS,
  type HiveSitePlacementOptions,
  isHiveSitePlaceable,
  isWithinHivePadOffset,
  terraformHiveGround,
};

export interface SpawnHiveOptions {
  species: FaunaSpeciesId;
  q: number;
  r: number;
  entranceQ?: number;
  entranceR?: number;
  initialResidents?: number;
  popCap?: number;
  replenishTicks?: number;
  patrolRadius?: number;
  hp?: number;
  footprintW?: number;
  footprintD?: number;
}

export interface SpawnFaunaBugOptions {
  species: FaunaSpeciesId;
  q: number;
  r: number;
  homeHiveId?: number;
  mode?: 'passive' | 'aggressive';
  targetColony?: number | null;
  hp?: number;
}

function isTileWalkableForFauna(
  state: PlanetState,
  q: number,
  r: number,
  occupied: ReadonlySet<number>,
  data?: CompiledDataLike,
  wrecks?: ReadonlySet<number>,
): boolean {
  if (!inHex(q, r, state.grid.radius)) return false;
  const idx = hexIndex(state.grid.radius).indexOf(q, r);
  if (idx < 0) return false;
  if (occupied.has(idx) || wrecks?.has(idx)) return false;
  const { terrain, prep, deposit } = state.grid.layers;
  const t = terrain[idx];
  const p = prep[idx];
  if (t === TERRAIN.deep || t === TERRAIN.shallow || t === TERRAIN.hole) return false;
  if (t === TERRAIN.rock && !isPreparedGround(p)) return false;
  if (p === PREP.ridge || p === PREP.moat) return false;
  if (deposit[idx] !== DEPOSIT.none) return false;
  return isGroundPassable(state.grid, idx, data);
}

function collectFaunaBlockedUnitIndices(state: PlanetState, data?: CompiledDataLike): Set<number> {
  const idx = hexIndex(state.grid.radius);
  const unitOcc = collectUnitOccupancy(state, -1, undefined, data);
  const blocked = new Set<number>(unitOcc.claimedGoals);
  for (const t of unitOcc.inTransitGoals) blocked.add(t);
  const cols = state.entities.cols;
  for (let r = 0; r < state.entities.count; r++) {
    if (cols.hpMax[r] > 0 && cols.hp[r] <= 0) continue;
    const ti = idx.indexOf(cols.q[r]!, cols.r[r]!);
    if (ti >= 0) blocked.add(ti);
  }
  return blocked;
}

/**
 * Finds a legal passable entrance tile adjacent to `(q, r)` (preferring `(preferredQ, preferredR)`).
 */
export function findPassableEntranceTile(
  state: PlanetState,
  q: number,
  r: number,
  preferredQ?: number,
  preferredR?: number,
  data?: CompiledDataLike,
): { q: number; r: number } | null {
  const occupied = occupiedGroundTiles(state, data);
  const wrecks = getWreckTileSet(state);
  if (
    preferredQ !== undefined &&
    preferredR !== undefined &&
    (preferredQ !== q || preferredR !== r) &&
    isTileWalkableForFauna(state, preferredQ, preferredR, occupied, data, wrecks)
  ) {
    return { q: preferredQ, r: preferredR };
  }
  for (const [dq, dr] of HEX_DIRS) {
    const nq = q + dq;
    const nr = r + dr;
    if (isTileWalkableForFauna(state, nq, nr, occupied, data, wrecks)) {
      return { q: nq, r: nr };
    }
  }
  return null;
}

/**
 * Finds a legal passable spawn tile at or around `hive.entranceQ, hive.entranceR` and `hive.q, hive.r`.
 * Returns `null` when all entrance tiles are blocked by walls, buildings, water, or deposits.
 */
export function findResidentSpawnTile(
  state: PlanetState,
  hive: HiveRecord,
  data?: CompiledDataLike,
): { q: number; r: number } | null {
  const occupied = occupiedGroundTiles(state, data);
  const wrecks = getWreckTileSet(state);
  const candidates: Array<{ q: number; r: number }> = [];
  const seen = new Set<string>();
  const push = (cq: number, cr: number) => {
    if (cq === hive.q && cr === hive.r) return;
    const key = `${cq},${cr}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (isTileWalkableForFauna(state, cq, cr, occupied, data, wrecks)) {
      candidates.push({ q: cq, r: cr });
    }
  };

  push(hive.entranceQ, hive.entranceR);
  for (const [dq, dr] of HEX_DIRS) {
    push(hive.entranceQ + dq, hive.entranceR + dr);
  }
  for (const [dq, dr] of HEX_DIRS) {
    push(hive.q + dq, hive.r + dr);
  }
  for (let dr = -2; dr <= 2; dr++) {
    for (let dq = Math.max(-2, -dr - 2); dq <= Math.min(2, -dr + 2); dq++) {
      if (hexDistance(0, 0, dq, dr) === 2) push(hive.q + dq, hive.r + dr);
    }
  }
  if (candidates.length === 0) return null;

  const hex = hexIndex(state.grid.radius);
  const blockedUnits = collectFaunaBlockedUnitIndices(state, data);
  return candidates.find((c) => !blockedUnits.has(hex.indexOf(c.q, c.r))) ?? null;
}

function pruneDeadResidents(state: PlanetState, hive: HiveRecord): void {
  const cols = state.entities.cols;
  hive.residentIds = hive.residentIds.filter((id) => {
    const r = rowOf(state.entities, id);
    return r >= 0 && cols.hp[r] > 0;
  });
}

/**
 * Spawns one passive resident bug at `hive`'s legal entrance via `placeSpawnedEntity` (`SIM-M-01`).
 * If the hive is destroyed, at `popCap`, or its entrance is blocked, postpones without an accumulated burst.
 */
export function spawnResidentBug(
  state: PlanetState,
  hiveOrId: HiveRecord | number,
  tick = state.meta.tick,
  data?: CompiledDataLike,
): number | null {
  const resolvedData = data ?? defaultFaunaData();
  const fauna = getFaunaHivesState(state);
  const hiveId = typeof hiveOrId === 'number' ? hiveOrId : hiveOrId.hiveId;
  const hive = fauna.hivesById[hiveId];
  if (!hive || hive.destroyed) return null;

  const hiveRow = rowOf(state.entities, hive.hiveId);
  if (hiveRow < 0 || state.entities.cols.hp[hiveRow] <= 0) {
    hive.destroyed = true;
    saveFaunaHivesState(state, fauna, tick);
    return null;
  }

  pruneDeadResidents(state, hive);
  if (hive.residentIds.length >= hive.popCap) {
    hive.lastReplenishTick = tick;
    saveFaunaHivesState(state, fauna, tick);
    return null;
  }

  const spawnTile = findResidentSpawnTile(state, hive, resolvedData);
  if (!spawnTile) {
    hive.lastReplenishTick = tick;
    saveFaunaHivesState(state, fauna, tick);
    return null;
  }

  const cfg = resolveSpeciesConfig(hive.species, resolvedData);
  const entityId = state.meta.nextEntityId++;
  const row = insertRow(state.entities, entityId, tick);
  const cols = state.entities.cols;
  cols.kind[row] = cfg.bugKind;
  cols.owner[row] = -1;
  cols.hp[row] = cfg.hp;
  cols.hpMax[row] = cfg.hp;
  cols.state[row] = ENTITY_STATE.idle;
  placeSpawnedEntity(state.entities, row, spawnTile.q, spawnTile.r, tick);

  const bugRecord: ResidentBugRecord = {
    entityId,
    species: hive.species,
    homeHiveId: hive.hiveId,
    mode: 'passive',
    targetColony: null,
    aggressiveColonies: [],
    cohortId: null,
    lastWanderTick: tick,
    lastAttackTick: -9999,
    spawnedTick: tick,
  };

  hive.residentIds.push(entityId);
  fauna.bugsById[entityId] = bugRecord;
  fauna.lastSeenHpByEntityId[entityId] = cfg.hp;
  saveFaunaHivesState(state, fauna, tick);
  return entityId;
}

/**
 * Spawns a species hive entity (`hiveBlackAnt` / `hiveBlueBeetle` / `hiveGreenSpitter`) via
 * `placeSpawnedEntity` (`SIM-M-01`) and populates its initial passive resident bugs.
 */
export function spawnHiveEntity(
  state: PlanetState,
  opts: SpawnHiveOptions,
  tick = state.meta.tick,
  data?: CompiledDataLike,
): number {
  const resolvedData = data ?? defaultFaunaData();
  const cfg = resolveSpeciesConfig(opts.species, resolvedData);
  const footprintW = opts.footprintW ?? 3;
  const footprintD = opts.footprintD ?? 3;
  terraformHiveGround(state, opts.q, opts.r, tick, resolvedData, Math.max(footprintW, footprintD));

  const entrance = findPassableEntranceTile(
    state,
    opts.q,
    opts.r,
    opts.entranceQ,
    opts.entranceR,
    resolvedData,
  ) ?? {
    q: opts.entranceQ ?? opts.q + 1,
    r: opts.entranceR ?? opts.r,
  };

  const hiveId = state.meta.nextEntityId++;
  const row = insertRow(state.entities, hiveId, tick);
  const cols = state.entities.cols;
  const hpMax = opts.hp ?? cfg.hiveHp;
  cols.kind[row] = cfg.hiveKind;
  cols.owner[row] = -1;
  cols.hp[row] = hpMax;
  cols.hpMax[row] = hpMax;
  cols.footprintW[row] = footprintW;
  cols.footprintD[row] = footprintD;
  cols.state[row] = ENTITY_STATE.active;
  placeSpawnedEntity(state.entities, row, opts.q, opts.r, tick);
  bumpPathEpoch(state.meta);

  const popCap = opts.popCap ?? cfg.popCap;
  const replenishTicks = opts.replenishTicks ?? cfg.replenishTicks;
  const patrolRadius = opts.patrolRadius ?? cfg.patrolRadius;

  const fauna = getFaunaHivesState(state);
  fauna.initialized = true;
  const hiveRecord: HiveRecord = {
    hiveId,
    species: opts.species,
    q: opts.q,
    r: opts.r,
    entranceQ: entrance.q,
    entranceR: entrance.r,
    hp: hpMax,
    hpMax,
    destroyed: false,
    popCap,
    replenishTicks,
    lastReplenishTick: tick,
    patrolRadius,
    residentIds: [],
    decisionIndex: 0,
    mode: 'passive',
    aggressionByColony: {},
    aggressiveColonies: [],
  };

  fauna.hivesById[hiveId] = hiveRecord;
  fauna.lastSeenHpByEntityId[hiveId] = hpMax;
  saveFaunaHivesState(state, fauna, tick);

  const initialCount = Math.min(popCap, opts.initialResidents ?? cfg.initialResidents);
  for (let i = 0; i < initialCount; i++) {
    spawnResidentBug(state, hiveId, tick, resolvedData);
  }
  return hiveId;
}

/**
 * Spawns a 3×3 species hive site and its initial resident bugs (`W07-29`).
 */
export function spawnHiveSite(
  state: PlanetState,
  opts: SpawnHiveOptions,
  tick = state.meta.tick,
  data?: CompiledDataLike,
): number {
  return spawnHiveEntity(
    state,
    {
      footprintW: 3,
      footprintD: 3,
      ...opts,
    },
    tick,
    data,
  );
}

/**
 * Spawns a single fauna bug entity (`blackAnt`, `blueBeetle`, `greenSpitter`) at `(opts.q, opts.r)` (`W07-29`).
 */
export function spawnFaunaBug(
  state: PlanetState,
  opts: SpawnFaunaBugOptions,
  tick = state.meta.tick,
  data?: CompiledDataLike,
): number {
  const resolvedData = data ?? defaultFaunaData();
  const cfg = resolveSpeciesConfig(opts.species, resolvedData);
  const occupied = occupiedGroundTiles(state, resolvedData);
  const wrecks = getWreckTileSet(state);
  const hex = hexIndex(state.grid.radius);
  const blockedUnits = collectFaunaBlockedUnitIndices(state, resolvedData);
  const cols = state.entities.cols;
  let spawnQ = opts.q;
  let spawnR = opts.r;
  const startIdx = hex.indexOf(spawnQ, spawnR);
  if (startIdx < 0 || blockedUnits.has(startIdx) || !isTileWalkableForFauna(state, spawnQ, spawnR, occupied, resolvedData, wrecks)) {
    const maxDist = Math.min(16, state.grid.radius);
    outer: for (let dist = 0; dist <= maxDist; dist++) {
      for (const [cq, cr] of ringCoords(opts.q, opts.r, dist)) {
        const ti = hex.indexOf(cq, cr);
        if (ti >= 0 && !blockedUnits.has(ti) && isTileWalkableForFauna(state, cq, cr, occupied, resolvedData, wrecks)) {
          spawnQ = cq;
          spawnR = cr;
          break outer;
        }
      }
    }
  }
  const entityId = state.meta.nextEntityId++;
  const row = insertRow(state.entities, entityId, tick);
  const hp = opts.hp ?? cfg.hp;
  cols.kind[row] = cfg.bugKind;
  cols.owner[row] = -1;
  cols.hp[row] = hp;
  cols.hpMax[row] = hp;
  cols.state[row] = ENTITY_STATE.idle;
  placeSpawnedEntity(state.entities, row, spawnQ, spawnR, tick);

  const fauna = getFaunaHivesState(state);
  const homeHiveId = opts.homeHiveId ?? Object.values(fauna.hivesById).find((h) => !h.destroyed && h.species === opts.species)?.hiveId ?? 0;
  const mode = opts.mode ?? 'passive';
  const targetColony = mode === 'aggressive' ? (opts.targetColony ?? 0) : null;
  const bugRecord: ResidentBugRecord = {
    entityId,
    species: opts.species,
    homeHiveId,
    mode,
    targetColony,
    aggressiveColonies: targetColony !== null ? [targetColony] : [],
    cohortId: null,
    lastWanderTick: tick,
    lastAttackTick: -9999,
    spawnedTick: tick,
  };
  fauna.bugsById[entityId] = bugRecord;
  fauna.lastSeenHpByEntityId[entityId] = hp;
  if (homeHiveId && fauna.hivesById[homeHiveId] && !fauna.hivesById[homeHiveId].residentIds.includes(entityId)) {
    fauna.hivesById[homeHiveId].residentIds.push(entityId);
  }
  saveFaunaHivesState(state, fauna, tick);
  return entityId;
}

/**
 * Materializes the planned worldgen hive sites on `state` into authoritative ECS hive and resident bug
 * entities (`fauna-hives-spec.md` §1–§3). Idempotent: returns existing hive IDs if already initialized.
 */
function touchesOwnedColonyTerritory(state: PlanetState, cq: number, cr: number): boolean {
  const hex = hexIndex(state.grid.radius);
  const owner = state.grid.layers.owner;
  const planarRadius = state.meta.planetType === 'desert' ? HIVE_PLANAR_RADIUS_DESERT : HIVE_PLANAR_RADIUS_DEFAULT;
  const bound = Math.ceil((planarRadius * 2) / Math.sqrt(3)) + 1;
  for (let dr = -bound; dr <= bound; dr++) {
    for (let dq = -bound; dq <= bound; dq++) {
      if (!isWithinHivePadOffset(dq, dr, planarRadius, HIVE_TERRAFORM_RADIUS)) continue;
      const ti = hex.indexOf(cq + dq, cr + dr);
      if (ti >= 0 && (owner[ti] ?? -1) >= 0) return true;
    }
  }
  return false;
}

export function materializeWorldgenHives(
  state: PlanetState,
  tick = state.meta.tick,
  data?: CompiledDataLike,
  opts?: PlanHiveSitesOptions & { initialResidents?: number },
): number[] {
  const fauna = getFaunaHivesState(state);
  const existingIds = Object.keys(fauna.hivesById)
    .map(Number)
    .sort((a, b) => a - b);
  if (fauna.initialized && existingIds.length > 0) {
    return existingIds;
  }

  const sites = opts
    ? planWorldgenHiveSites(state, opts)
    : getWorldgenHiveSites(state);

  fauna.initialized = true;
  saveFaunaHivesState(state, fauna, tick);

  const spawnedHiveIds: number[] = [];
  for (const site of sites) {
    if (hexDistance(0, 0, site.q, site.r) > state.grid.radius) continue;
    if (touchesOwnedColonyTerritory(state, site.q, site.r)) continue;
    const hiveId = spawnHiveEntity(
      state,
      {
        species: site.species,
        q: site.q,
        r: site.r,
        entranceQ: site.entranceQ,
        entranceR: site.entranceR,
        ...(opts?.initialResidents !== undefined ? { initialResidents: opts.initialResidents } : {}),
      },
      tick,
      data,
    );
    spawnedHiveIds.push(hiveId);
  }
  return spawnedHiveIds;
}
