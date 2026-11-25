import { compileData, type CompiledRow } from '../../data';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { placeSpawnedEntity } from '../../ecs/placement';
import { insertRow, rowOf } from '../../ecs/store';
import { hexDistance, hexIndex, inHex } from '../../grid/hex';
import { DEPOSIT, PREP, TERRAIN } from '../../grid/layers';
import { bumpPathEpoch, setTileDeposit, setTileOwner } from '../../grid/tileModel';
import type { CompiledDataLike } from '../../kernel/config';
import { defineCommandHandler } from '../../kernel/commands';
import type { StepContext } from '../../kernel/context';
import { touchTile, type PlanetState } from '../../kernel/state';
import { parseArgs } from '../command';
import { occupiedGroundTiles } from '../construction/occupancy';
import { OCCUPYING_BUILDING_KINDS } from '../construction/placement';
import {
  buildingKindName,
  getFootprintTileIndices,
  resolveBuildingRow,
} from '../economy/buildingRows';
import { syncColonyDepotCaps } from '../economy/ledger';
import { colonyWho } from '../find';
import { revealVision } from '../hq';
import { recomputeAllColonyPower } from '../power-core';
import { syncColonyThreatStage } from '../progression/threatStage';
import { syncColonySupply } from '../supply';

function optNum(row: CompiledRow, key: string, fallback = 0): number {
  const v = row[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
import { claimTerritoryRadius } from '../territory-claim';
import { ensureDevColony, findColonyAnchorTile, resolveColonyIdx } from './w07Helpers';

const BUILDING_ALIASES: Readonly<Record<string, string>> = {
  'building.commandHub': 'commandHub',
  'building.turret': 'autocannon',
  'building.laserTower': 'laserTower',
  'building.roboticsFactory': 'roboticsFactory',
  'building.droneArray': 'droneControlArray',
  'building.sensorArray': 'sensorArray',
  'building.pylon': 'pylon',
  'building.capacitor': 'capacitor',
  'building.solar': 'solar',
  'building.wind': 'wind',
  'building.coalGen': 'thermal',
  'building.supplyDepot': 'supplyDepot',
  'building.tradeHub': 'tradeHub',
  'building.mine': 'metalsExtractor',
  'building.waterPump': 'waterExtractor',
  turret: 'autocannon',
  pulseTurret: 'laserTower',
  droneArray: 'droneControlArray',
  mine: 'metalsExtractor',
  quarry: 'mineralsQuarry',
  waterPump: 'waterExtractor',
  oilWell: 'petroleumWell',
  coalGen: 'thermal',
  hub: 'commandHub',
};

const EXTRACTOR_KINDS = new Set<number>([
  ENTITY_KIND.metalsExtractor,
  ENTITY_KIND.mineralsQuarry,
  ENTITY_KIND.waterExtractor,
  ENTITY_KIND.petroleumWell,
]);

let cachedSandboxData: CompiledDataLike | null = null;
function fallbackSandboxData(): CompiledDataLike {
  if (!cachedSandboxData) {
    cachedSandboxData = compileData(new Set(['W00', 'W01', 'W02', 'W03', 'W04', 'W05', 'W06', 'W07', 'W10']));
  }
  return cachedSandboxData;
}

export interface SpawnCompletedBuildingOptions {
  building: string;
  owner?: number;
  q?: number;
  r?: number;
  rot?: number;
  tier?: number;
  fallbackNear?: boolean;
  tick?: number;
  data?: CompiledDataLike;
  ctx?: StepContext;
}

export type SpawnCompletedBuildingResult =
  | { ok: true; entityId: number; building: string; kind: number; q: number; r: number }
  | { ok: false; code: 'invalid_args' | 'site_blocked' };

function canonicalBuildingKey(raw: string): string {
  const trimmed = raw.trim();
  return BUILDING_ALIASES[trimmed] ?? trimmed;
}

function resolveSpawnBuildingSpec(
  rawName: string,
  data?: CompiledDataLike,
): { row: CompiledRow; entityKind: number; building: string } | null {
  const key = canonicalBuildingKey(rawName);
  const direct = resolveBuildingRow(key, data);
  const resolved = direct ?? resolveBuildingRow(key, fallbackSandboxData());
  if (!resolved) return null;
  return {
    row: resolved.row,
    entityKind: resolved.entityKind,
    building: String(resolved.row.building ?? buildingKindName(resolved.entityKind)),
  };
}

function isFootprintPlaceable(
  state: PlanetState,
  q: number,
  r: number,
  w: number,
  d: number,
  rot: number,
  allowWater: boolean,
  blocked: ReadonlySet<number>,
): number[] | null {
  if (!inHex(q, r, state.grid.radius)) return null;
  const fp = getFootprintTileIndices(state, q, r, w, d, rot);
  if (!fp.valid || fp.indices.length === 0) return null;
  const terrain = state.grid.layers.terrain;
  for (const tileIdx of fp.indices) {
    const t = terrain[tileIdx] ?? TERRAIN.flat;
    if (t === TERRAIN.deep) return null;
    if (t === TERRAIN.shallow && !allowWater) return null;
    if (blocked.has(tileIdx)) return null;
  }
  return fp.indices;
}

function collectBlockedBuildingTiles(state: PlanetState): Set<number> {
  const occupied = new Set(occupiedGroundTiles(state));
  const { count, cols } = state.entities;
  for (let row = 0; row < count; row++) {
    if (cols.hp[row]! <= 0) continue;
    const kind = cols.kind[row]!;
    if (!OCCUPYING_BUILDING_KINDS.has(kind)) continue;
    const fp = getFootprintTileIndices(
      state,
      Math.round(cols.q[row]!),
      Math.round(cols.r[row]!),
      cols.footprintW[row] || 1,
      cols.footprintD[row] || 1,
      cols.rot[row] || 0,
    );
    for (const tileIdx of fp.indices) occupied.add(tileIdx);
  }
  return occupied;
}

function findNearestBuildingSite(
  state: PlanetState,
  centerQ: number,
  centerR: number,
  w: number,
  d: number,
  rot: number,
  allowWater: boolean,
  blocked: ReadonlySet<number>,
): { q: number; r: number; indices: number[] } | null {
  const maxRing = Math.min(state.grid.radius, 24);
  for (let dist = 0; dist <= maxRing; dist++) {
    for (let dq = -dist; dq <= dist; dq++) {
      for (let dr = -dist; dr <= dist; dr++) {
        if (hexDistance(0, 0, dq, dr) !== dist) continue;
        const q = centerQ + dq;
        const r = centerR + dr;
        const indices = isFootprintPlaceable(state, q, r, w, d, rot, allowWater, blocked);
        if (indices) return { q, r, indices };
      }
    }
  }
  return null;
}

function prepareSpawnSiteTiles(
  state: PlanetState,
  indices: readonly number[],
  owner: number,
  entityKind: number,
  tick: number,
): void {
  const terrain = state.grid.layers.terrain as Uint8Array;
  const prep = state.grid.layers.prep as Uint8Array;
  const height = state.grid.layers.height as Float32Array;
  const deposit = state.grid.layers.deposit;
  const keepDeposit = EXTRACTOR_KINDS.has(entityKind);
  let targetH = 0.1;
  if (indices.length > 0) {
    let sum = 0;
    for (const idx of indices) sum += height[idx] ?? 0.1;
    targetH = Math.fround(Math.max(0.05, Math.min(2.5, sum / indices.length)));
  }

  for (const idx of indices) {
    if (terrain[idx] !== TERRAIN.shallow) {
      terrain[idx] = TERRAIN.flat;
      prep[idx] = PREP.prepared;
      height[idx] = targetH;
    }
    if (!keepDeposit && (deposit[idx] ?? DEPOSIT.none) !== DEPOSIT.none) {
      setTileDeposit(state.grid, idx, DEPOSIT.none, 0, tick, 0);
    }
    setTileOwner(state.grid, idx, owner, tick);
    touchTile(state, idx, tick);
  }
}

export function spawnCompletedBuilding(
  state: PlanetState,
  opts: SpawnCompletedBuildingOptions,
): SpawnCompletedBuildingResult {
  const tick = opts.tick ?? opts.ctx?.tick ?? state.meta.tick;
  const data = opts.data ?? opts.ctx?.data;
  const owner = opts.owner ?? 0;
  const spec = resolveSpawnBuildingSpec(opts.building, data);
  if (!spec) return { ok: false, code: 'invalid_args' };

  const col = ensureDevColony(state, owner, tick);
  const fpFallback = optNum(spec.row, 'footprint', 1);
  const w = Math.max(1, Math.round(optNum(spec.row, 'footprintW', fpFallback) || fpFallback));
  const d = Math.max(1, Math.round(optNum(spec.row, 'footprintD', w) || w));
  const rot = opts.rot ?? 0;
  const allowWater = spec.entityKind === ENTITY_KIND.waterExtractor;
  const blocked = collectBlockedBuildingTiles(state);

  const staging = (state.blobs.combatTest?.value as { staging?: { q: number; r: number } } | undefined)?.staging;
  const fallbackAnchor = staging ?? findColonyAnchorTile(state, owner);
  let q = opts.q;
  let r = opts.r;
  let indices: number[] | null;
  if (typeof q === 'number' && typeof r === 'number') {
    indices = isFootprintPlaceable(state, q, r, w, d, rot, allowWater, blocked);
    if (!indices && opts.fallbackNear) {
      const found = findNearestBuildingSite(state, q, r, w, d, rot, allowWater, blocked);
      if (found) {
        q = found.q;
        r = found.r;
        indices = found.indices;
      }
    }
    if (!indices) return { ok: false, code: 'site_blocked' };
  } else {
    const found = findNearestBuildingSite(state, fallbackAnchor.q, fallbackAnchor.r, w, d, rot, allowWater, blocked);
    if (!found) return { ok: false, code: 'site_blocked' };
    q = found.q;
    r = found.r;
    indices = found.indices;
  }

  prepareSpawnSiteTiles(state, indices, owner, spec.entityKind, tick);
  const entityId = opts.ctx?.newEntityId ? opts.ctx.newEntityId() : state.meta.nextEntityId++;
  const rowIdx = insertRow(state.entities, entityId, tick);
  const cols = state.entities.cols;
  const hp = Math.fround(Math.max(100, optNum(spec.row, 'hp', 250)));
  cols.kind[rowIdx] = spec.entityKind;
  cols.owner[rowIdx] = owner;
  cols.tier[rowIdx] = opts.tier ?? 1;
  cols.footprintW[rowIdx] = w;
  cols.footprintD[rowIdx] = d;
  cols.rot[rowIdx] = rot;
  cols.hp[rowIdx] = hp;
  cols.hpMax[rowIdx] = hp;
  cols.state[rowIdx] = ENTITY_STATE.active;
  cols.progress[rowIdx] = 1;
  placeSpawnedEntity(state.entities, rowIdx, q, r, tick);

  if (spec.entityKind === ENTITY_KIND.commandHub) {
    col.hubEntityId = entityId;
    col.changedAt = tick;
    claimTerritoryRadius(state, { colonyId: owner, q, r, tick, data });
    syncColonyThreatStage(state, owner, tick);
  }
  const hx = hexIndex(state.grid.radius);
  const tileIdx = hx.indexOf(q, r);
  if (tileIdx >= 0) touchTile(state, tileIdx, tick);

  bumpPathEpoch(state.meta);
  syncColonyDepotCaps(state, owner, tick);
  syncColonySupply(state, owner, tick, data);
  recomputeAllColonyPower(state, data, tick);
  const viewRadius = Math.max(6, Math.round(optNum(spec.row, 'viewRadius', 8)));
  revealVision(state, owner, q, r, viewRadius, tick);

  if (opts.ctx && rowOf(state.entities, entityId) >= 0) {
    const { colonyIdStr, who } = colonyWho(state, owner);
    opts.ctx.emit({
      kind: 'buildingCompleted',
      colonyIds: [colonyIdStr],
      data: { ...who, entityId, building: spec.building, tier: opts.tier ?? 1, q, r },
    });
  }
  return { ok: true, entityId, building: spec.building, kind: spec.entityKind, q, r };
}

export const devSpawnBuilding = defineCommandHandler({
  kind: 'dev.spawnbuilding',
  wave: 'W07',
  handle(state, cmd, ctx) {
    const parsed = parseArgs('dev.spawnbuilding', cmd.args);
    if (!parsed) return 'invalid_args';
    const owner = parsed.owner !== undefined
      ? parsed.owner
      : resolveColonyIdx(cmd, parsed.colonyIndex);
    const res = spawnCompletedBuilding(state, {
      building: parsed.building,
      owner,
      q: parsed.q,
      r: parsed.r,
      rot: parsed.rot,
      tier: parsed.tier,
      fallbackNear: parsed.fallbackNear,
      tick: ctx.tick,
      data: ctx.data,
      ctx,
    });
    if (!res.ok) return res.code;
  },
});
