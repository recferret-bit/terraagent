import type { CompiledRow } from '../../data';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { hexDistance, hexIndex } from '../../grid/hex';
import type { CompiledDataLike } from '../../kernel/config';
import { setBlob, type PlanetState } from '../../kernel/state';
import { defaultW01Data } from '../rows';
import { mobileStats } from '../../units/mobility';

export const COMBAT_VISION_BLOB = 'combatVision';
export const VISION_UPDATE_INTERVAL_TICKS = 5;
export const BEACON_ENTITY_KIND = 21;

export interface CombatVisionBlob {
  updatedAtTick: number;
  entitySnap: string;
  byColony: Record<number, number[]>;
}

const colonySetCache = new WeakMap<CombatVisionBlob, Map<number, ReadonlySet<number>>>();

function getCombatConfigRow(data?: CompiledDataLike): CompiledRow | undefined {
  const table = data?.tables?.combatUnits as Record<string, CompiledRow> | undefined;
  return table?.combatConfig;
}

/** Number of ticks between shared colony vision cache updates (`combatUnits.combatConfig.visionUpdateTicks ?? 5`). */
export function getVisionUpdateIntervalTicks(data?: CompiledDataLike): number {
  const raw = Number(getCombatConfigRow(data)?.visionUpdateTicks ?? VISION_UPDATE_INTERVAL_TICKS);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : VISION_UPDATE_INTERVAL_TICKS;
}

/** Footprint size (width in tiles) for an entity kind from compiled data tables or defaults. */
export function getEntityFootprintSize(kind: number, data?: CompiledDataLike): number {
  const combatUnits = data?.tables?.combatUnits as Record<string, CompiledRow> | undefined;
  const grid = data?.tables?.grid as Record<string, CompiledRow> | undefined;
  const eco = data?.tables?.economyT1Basic as Record<string, CompiledRow> | undefined;
  const hub = data?.tables?.hub as Record<string, CompiledRow> | undefined;
  const tradeHub = data?.tables?.tradeHub as Record<string, CompiledRow> | undefined;

  if (kind === ENTITY_KIND.hub) return Number(hub?.t1?.footprintW ?? hub?.t1?.footprint ?? 3);
  if (kind === ENTITY_KIND.pod || kind === BEACON_ENTITY_KIND) return 1;
  if (kind === ENTITY_KIND.roboticsFactory) {
    return Number(combatUnits?.roboticsFactory?.footprintW ?? combatUnits?.roboticsFactory?.footprint ?? 3);
  }
  if (kind === ENTITY_KIND.droneControlArray) {
    return Number(combatUnits?.droneControlArray?.footprintW ?? combatUnits?.droneControlArray?.footprint ?? 1);
  }
  if (kind === ENTITY_KIND.autocannon) {
    return Number(combatUnits?.autocannon?.footprintW ?? combatUnits?.autocannon?.footprint ?? 1);
  }
  if (kind === ENTITY_KIND.laserTower) {
    return Number(combatUnits?.laserTower?.footprintW ?? combatUnits?.laserTower?.footprint ?? 1);
  }
  if (kind === ENTITY_KIND.pylon) {
    return Number(grid?.pylon?.footprintW ?? grid?.pylon?.footprint ?? 1);
  }
  if (kind === ENTITY_KIND.metalsExtractor) {
    return Number(eco?.metalsExtractor?.footprintW ?? eco?.metalsExtractor?.footprint ?? 2);
  }
  if (kind === ENTITY_KIND.solar) {
    return Number(eco?.solar?.footprintW ?? eco?.solar?.footprint ?? 2);
  }
  if (kind === ENTITY_KIND.tradeHub) {
    return Number(tradeHub?.t1?.footprintW ?? tradeHub?.t1?.footprint ?? 2);
  }
  if (
    kind === ENTITY_KIND.capacitor ||
    kind === ENTITY_KIND.wind ||
    kind === ENTITY_KIND.thermal ||
    kind === ENTITY_KIND.supplyDepot ||
    kind === ENTITY_KIND.mineralsQuarry ||
    kind === ENTITY_KIND.waterExtractor ||
    kind === ENTITY_KIND.petroleumWell
  ) {
    return 2;
  }
  return 1;
}

/**
 * Spotting radius (in hex tiles) contributed by an entity of `kind` (`UO-C-06`, B2 default):
 * - Mobile units contribute their `viewRadius` (`Recon = 10`, `HQ = 9`, `Harvester/Builder = 7`).
 * - Fauna units contribute `6` tiles.
 * - Command Hub, Drop Pod, and Beacon T1 contribute `footprint + 6` (`hubBeaconViewBonus`).
 * - All other colony buildings contribute `footprint + 4` (`buildingViewBonus`), so 1x1 turrets (`autocannon`,
 *   `laserTower`) have spotting radius `5` (`1 + 4`) while long-range weapons (`range > viewRadius`, e.g. Autocannon
 *   `range = 8`) require a spotter for targets at `6..8` tiles.
 */
export function getEntitySpottingRadius(kind: number, data?: CompiledDataLike): number {
  if (kind === ENTITY_KIND.recon) {
    const combatUnits = data?.tables?.combatUnits as Record<string, CompiledRow> | undefined;
    const raw = Number(combatUnits?.recon?.viewRadius);
    if (Number.isFinite(raw) && raw > 0 && raw !== 8) return raw;
    return 10;
  }

  if (kind === ENTITY_KIND.hq || kind === ENTITY_KIND.harvester || kind === ENTITY_KIND.builder) {
    return mobileStats(kind, data ?? defaultW01Data())?.viewRadius ?? 7;
  }

  if (
    kind === ENTITY_KIND.blackAnt ||
    kind === ENTITY_KIND.blueBeetle ||
    kind === ENTITY_KIND.greenSpitter ||
    kind === ENTITY_KIND.hiveBlackAnt ||
    kind === ENTITY_KIND.hiveBlueBeetle ||
    kind === ENTITY_KIND.hiveGreenSpitter
  ) {
    return 6;
  }

  const cfg = getCombatConfigRow(data);
  const footprint = getEntityFootprintSize(kind, data);

  if (kind === ENTITY_KIND.hub || kind === ENTITY_KIND.pod || kind === BEACON_ENTITY_KIND) {
    const hubBonus = Number(cfg?.hubBeaconViewBonus ?? 6);
    return footprint + hubBonus;
  }

  if (kind === ENTITY_KIND.devProbe) return 0;

  const buildingBonus = Number(cfg?.buildingViewBonus ?? 4);
  return footprint + buildingBonus;
}

function isEntityContributingVision(stateCode: number): boolean {
  return (
    stateCode !== ENTITY_STATE.constructing &&
    stateCode !== ENTITY_STATE.inert &&
    stateCode !== ENTITY_STATE.descending
  );
}

/**
 * Computes the set of all valid tile indices currently spotted by `colonyIndex` from its alive, active units and
 * completed buildings (`UO-C-06`).
 */
export function computeColonySpottedTileIndices(
  state: PlanetState,
  colonyIndex: number,
  data?: CompiledDataLike,
): Set<number> {
  const spotted = new Set<number>();
  if (colonyIndex < 0) return spotted;

  const idx = hexIndex(state.grid.radius);
  const e = state.entities;
  const cols = e.cols;

  for (let row = 0; row < e.count; row++) {
    if (cols.owner[row] !== colonyIndex) continue;
    if (cols.hp[row] <= 0) continue;
    if (!isEntityContributingVision(cols.state[row])) continue;

    const radius = Math.floor(getEntitySpottingRadius(cols.kind[row], data));
    if (radius <= 0) continue;

    const cq = cols.q[row];
    const cr = cols.r[row];
    for (let dq = -radius; dq <= radius; dq++) {
      const drMin = Math.max(-radius, -dq - radius);
      const drMax = Math.min(radius, -dq + radius);
      for (let dr = drMin; dr <= drMax; dr++) {
        const tileIdx = idx.indexOf(cq + dq, cr + dr);
        if (tileIdx >= 0) spotted.add(tileIdx);
      }
    }
  }

  return spotted;
}

function buildEntityVisionSnapshot(state: PlanetState): string {
  const e = state.entities;
  const cols = e.cols;
  const parts: string[] = [];
  for (let r = 0; r < e.count; r++) {
    if (cols.owner[r] < 0 || cols.hp[r] <= 0 || !isEntityContributingVision(cols.state[r])) continue;
    parts.push(`${cols.id[r]}:${cols.owner[r]}:${cols.kind[r]}:${cols.q[r]},${cols.r[r]}`);
  }
  return parts.join(';');
}

function collectActiveColonyIndices(state: PlanetState): Set<number> {
  const indices = new Set<number>();
  for (const col of state.colonies) {
    if (col && col.index >= 0) indices.add(col.index);
  }
  const cols = state.entities.cols;
  for (let r = 0; r < state.entities.count; r++) {
    if (cols.owner[r] >= 0 && cols.hp[r] > 0) indices.add(cols.owner[r]);
  }
  return indices;
}

/**
 * Updates the shared colony vision cache in `state.blobs.combatVision` on the 5-tick cadence (`tick % 5 === 0` or
 * `tick - updatedAtTick >= 5`), or immediately when `force === true` or no cache exists yet.
 */
export function updateColonyVisionCache(
  state: PlanetState,
  tick: number = state.meta.tick,
  data?: CompiledDataLike,
  force = false,
): CombatVisionBlob {
  const existing = state.blobs[COMBAT_VISION_BLOB]?.value as CombatVisionBlob | undefined;
  const interval = getVisionUpdateIntervalTicks(data);

  const shouldUpdate =
    force ||
    !existing ||
    tick - existing.updatedAtTick >= interval ||
    (tick > existing.updatedAtTick && tick % interval === 0);

  if (!shouldUpdate && existing) {
    return existing;
  }

  const byColony: Record<number, number[]> = {};
  const setMap = new Map<number, ReadonlySet<number>>();
  for (const colonyIndex of collectActiveColonyIndices(state)) {
    const set = computeColonySpottedTileIndices(state, colonyIndex, data);
    byColony[colonyIndex] = Array.from(set);
    setMap.set(colonyIndex, set);
  }

  const nextBlob: CombatVisionBlob = {
    updatedAtTick: tick,
    entitySnap: buildEntityVisionSnapshot(state),
    byColony,
  };
  colonySetCache.set(nextBlob, setMap);
  const existingBlob = state.blobs[COMBAT_VISION_BLOB];
  if (existingBlob) {
    existingBlob.value = nextBlob;
  } else {
    setBlob(state, COMBAT_VISION_BLOB, nextBlob, tick);
  }
  return nextBlob;
}

/** Returns the cached spotted tile index set for `colonyIndex`, initializing or refreshing if due. */
export function getColonySpottedTileSet(
  state: PlanetState,
  colonyIndex: number,
  data?: CompiledDataLike,
): ReadonlySet<number> {
  if (colonyIndex < 0) return new Set<number>();

  const existing = state.blobs[COMBAT_VISION_BLOB]?.value as CombatVisionBlob | undefined;
  const interval = getVisionUpdateIntervalTicks(data);
  const tick = state.meta.tick;

  const blob =
    !existing || tick - existing.updatedAtTick >= interval
      ? updateColonyVisionCache(state, tick, data, true)
      : existing;

  let setMap = colonySetCache.get(blob);
  if (!setMap) {
    setMap = new Map<number, ReadonlySet<number>>();
    colonySetCache.set(blob, setMap);
  }

  let colonySet = setMap.get(colonyIndex);
  if (!colonySet) {
    const arr = blob.byColony[colonyIndex];
    if (arr) {
      colonySet = new Set<number>(arr);
    } else {
      const computed = computeColonySpottedTileIndices(state, colonyIndex, data);
      blob.byColony[colonyIndex] = Array.from(computed);
      colonySet = computed;
    }
    setMap.set(colonyIndex, colonySet);
  }

  return colonySet;
}

/** True when axial tile `(q, r)` is inside `colonyIndex`'s shared colony view set (`UO-C-06`). */
export function isTileSpottedByColony(
  state: PlanetState,
  colonyIndex: number,
  q: number,
  r: number,
  data?: CompiledDataLike,
): boolean {
  if (colonyIndex < 0) return false;
  const tileIdx = hexIndex(state.grid.radius).indexOf(q, r);
  if (tileIdx < 0) return false;
  return getColonySpottedTileSet(state, colonyIndex, data).has(tileIdx);
}

/** True when entity `targetRow` is alive and stands on a tile spotted by `colonyIndex`. */
export function isTargetSpottedByColony(
  state: PlanetState,
  colonyIndex: number,
  targetRow: number,
  data?: CompiledDataLike,
): boolean {
  if (targetRow < 0 || targetRow >= state.entities.count) return false;
  const cols = state.entities.cols;
  if (cols.hp[targetRow] <= 0) return false;
  return isTileSpottedByColony(state, colonyIndex, cols.q[targetRow], cols.r[targetRow], data);
}

/**
 * True when `attackerRow` can fire on `targetRow` with a weapon of `weaponRange` (`UO-C-06`):
 * - Target must be alive and within `weaponRange` hexes of the attacker.
 * - Fauna attackers (`owner < 0`) require only `dist <= weaponRange`.
 * - Colony attackers (`owner >= 0`) require the target to be in the colony's shared view set (`isTargetSpottedByColony`).
 */
export function canAttackerSpotOrFireOnTarget(
  state: PlanetState,
  attackerRow: number,
  targetRow: number,
  weaponRange: number,
  data?: CompiledDataLike,
): boolean {
  if (
    attackerRow < 0 ||
    attackerRow >= state.entities.count ||
    targetRow < 0 ||
    targetRow >= state.entities.count
  ) {
    return false;
  }
  const cols = state.entities.cols;
  if (cols.hp[attackerRow] <= 0 || cols.hp[targetRow] <= 0) return false;

  const dist = hexDistance(cols.q[attackerRow], cols.r[attackerRow], cols.q[targetRow], cols.r[targetRow]);
  if (dist > weaponRange) return false;

  const owner = cols.owner[attackerRow];
  if (owner < 0) return true;

  return isTargetSpottedByColony(state, owner, targetRow, data);
}
