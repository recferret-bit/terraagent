import type { ResourceKey } from '@terra/contracts';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { hexDistance, hexIndex } from '../../grid/hex';
import { DEPOSIT } from '../../grid/layers';
import { isGroundPassable } from '../../grid/tileModel';
import type { CompiledDataLike } from '../../kernel/config';
import type { ColonyState, PlanetState } from '../../kernel/state';
import { hasActiveTruce } from '../diplomacy/store';
import { resolveBuildingRow } from '../economy/buildingRows';
import {
  getEffectiveColonyStageForShield,
  getPvpState,
  isW18PvpActive,
  resolvePvpConfig,
} from '../pvp/store';
import { getRivalColonyMeta } from './store';

export interface ColonyScan {
  anchorQ: number;
  anchorR: number;
  workerCount: number;
  harvestingWorkerCount: number;
  reconCount: number;
  extractorCount: number;
  turretCount: number;
  factoryCount: number;
  powerPlantCount: number;
  pylonCount: number;
  depotCount: number;
  avgBuildingHpRatio: number;
  damagedBuilding: { id: number; q: number; r: number; hpRatio: number } | null;
  idleUnits: Array<{ id: number; kind: number; q: number; r: number }>;
  nearestEnemy: { colonyIndex: number; q: number; r: number; dist: number } | null;
}

export function sectorOfColony(col: ColonyState): string {
  return typeof col.foundingSectorId === 'string' && col.foundingSectorId ? col.foundingSectorId : 'sec_0_0';
}

export function actorIdOfBot(state: PlanetState, col: ColonyState): string {
  const pid = typeof col.playerId === 'string' && col.playerId ? col.playerId : undefined;
  if (pid) return pid;
  const meta = getRivalColonyMeta(state, col.index);
  const rawHandle = (col as { handle?: unknown }).handle;
  const handle = typeof rawHandle === 'string' && rawHandle ? rawHandle : undefined;
  return `ai:${handle ?? meta?.colonyId ?? (col.id || `col_${col.index}`)}`;
}

export function stockCount(col: ColonyState, key: string): number {
  const stockMap = (col as { stock?: Record<string, number> }).stock;
  const raw = stockMap?.[key];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
}

export function crossedCadence(prevTick: number, nextTick: number, cadence: number, phase: number): boolean {
  if (nextTick <= prevTick) return false;
  if (prevTick <= 0 && nextTick >= 1) return true;
  return Math.floor((nextTick - phase) / cadence) > Math.floor((prevTick - phase) / cadence);
}

function isColonyAttackableForBot(
  state: PlanetState,
  attackerColonyIndex: number,
  targetColonyIndex: number,
  data?: CompiledDataLike,
): boolean {
  if (targetColonyIndex < 0 || targetColonyIndex === attackerColonyIndex) return false;
  const targetCol = state.colonies[targetColonyIndex];
  if (!targetCol || targetCol.status === 'eliminated') return false;
  const tick = state.meta.tick;
  if (hasActiveTruce(state, attackerColonyIndex, targetColonyIndex, tick)) return false;
  if (!isW18PvpActive(data)) return true;
  const rec = getPvpState(state).byColony[String(targetColonyIndex)];
  if (!rec || rec.shieldDropped || rec.raidProtectedUntil <= tick) return true;
  const cfg = resolvePvpConfig(data);
  if (!rec.manualShieldOverride && getEffectiveColonyStageForShield(state, targetColonyIndex) >= cfg.shieldDropStage) {
    return true;
  }
  return false;
}

export function buildingCostOf(building: string, data: CompiledDataLike): Partial<Record<ResourceKey, number>> {
  const resolved = resolveBuildingRow(building, data);
  const raw = resolved?.row?.cost;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const cost: Partial<Record<ResourceKey, number>> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) cost[k as ResourceKey] = v;
  }
  return cost;
}

export function findNearestPassableDeposit(
  state: PlanetState,
  q: number,
  r: number,
  maxDist: number,
  data?: CompiledDataLike,
): { q: number; r: number } | null {
  const hx = hexIndex(state.grid.radius);
  const dep = state.grid.layers.deposit;
  let best: { q: number; r: number; d: number } | null = null;
  for (let dq = -maxDist; dq <= maxDist; dq++) {
    for (let dr = -maxDist; dr <= maxDist; dr++) {
      const dist = hexDistance(0, 0, dq, dr);
      if (dist === 0 || dist > maxDist) continue;
      const tq = q + dq;
      const tr = r + dr;
      const idx = hx.indexOf(tq, tr);
      if (idx < 0 || (dep[idx] ?? DEPOSIT.none) === DEPOSIT.none) continue;
      if (!isGroundPassable(state, idx, data)) continue;
      if (!best || dist < best.d) best = { q: tq, r: tr, d: dist };
    }
  }
  return best ? { q: best.q, r: best.r } : null;
}

export function scanColonyState(
  state: PlanetState,
  colIdx: number,
  fallbackQ: number,
  fallbackR: number,
  data?: CompiledDataLike,
): ColonyScan {
  const cols = state.entities.cols;
  let anchorQ = fallbackQ;
  let anchorR = fallbackR;
  let anchorRank = 0;
  let workerCount = 0;
  let harvestingWorkerCount = 0;
  let reconCount = 0;
  let extractorCount = 0;
  let turretCount = 0;
  let factoryCount = 0;
  let powerPlantCount = 0;
  let pylonCount = 0;
  let depotCount = 0;
  let bHp = 0;
  let bHpMax = 0;
  let damagedBuilding: ColonyScan['damagedBuilding'] = null;
  const idleUnits: ColonyScan['idleUnits'] = [];
  const hostileRows: Array<{ owner: number; q: number; r: number }> = [];

  for (let row = 0; row < state.entities.count; row++) {
    const owner = cols.owner[row] ?? -1;
    const hp = cols.hp[row] ?? 0;
    const st = cols.state[row] ?? 0;
    if (hp <= 0 || st === ENTITY_STATE.inert) continue;
    const kind = cols.kind[row] ?? -1;
    const q = Math.round(cols.q[row] ?? 0);
    const r = Math.round(cols.r[row] ?? 0);

    if (owner !== colIdx) {
      if (owner >= 0 && isColonyAttackableForBot(state, colIdx, owner, data)) {
        hostileRows.push({ owner, q, r });
      }
      continue;
    }

    const rank = kind === ENTITY_KIND.hub ? 3 : kind === ENTITY_KIND.hq ? 2 : kind === ENTITY_KIND.pod ? 1 : 0;
    if (rank > anchorRank) {
      anchorRank = rank;
      anchorQ = q;
      anchorR = r;
    }
    if (kind === ENTITY_KIND.worker) {
      workerCount++;
      if (st === ENTITY_STATE.harvesting) harvestingWorkerCount++;
      if (st === ENTITY_STATE.idle) idleUnits.push({ id: cols.id[row]!, kind, q, r });
    } else if (kind === ENTITY_KIND.recon) {
      reconCount++;
      if (st === ENTITY_STATE.idle) idleUnits.push({ id: cols.id[row]!, kind, q, r });
    } else {
      const hpMax = Math.max(1, cols.hpMax[row] ?? hp);
      const ratio = hp / hpMax;
      bHp += hp;
      bHpMax += hpMax;
      if (ratio < 0.8 && (!damagedBuilding || ratio < damagedBuilding.hpRatio)) {
        damagedBuilding = { id: cols.id[row]!, q, r, hpRatio: ratio };
      }
      if (kind === ENTITY_KIND.metalsExtractor || kind === ENTITY_KIND.mineralsQuarry) extractorCount++;
      else if (kind === ENTITY_KIND.turret || kind === ENTITY_KIND.laserTower) turretCount++;
      else if (kind === ENTITY_KIND.roboticsFactory) factoryCount++;
      else if (kind === ENTITY_KIND.wind || kind === ENTITY_KIND.solar || kind === ENTITY_KIND.thermal) powerPlantCount++;
      else if (kind === ENTITY_KIND.pylon) pylonCount++;
      else if (kind === ENTITY_KIND.supplyDepot) depotCount++;
    }
  }

  let nearestEnemy: ColonyScan['nearestEnemy'] = null;
  for (const h of hostileRows) {
    const dist = hexDistance(anchorQ, anchorR, h.q, h.r);
    if (!nearestEnemy || dist < nearestEnemy.dist) nearestEnemy = { colonyIndex: h.owner, q: h.q, r: h.r, dist };
  }

  return {
    anchorQ,
    anchorR,
    workerCount,
    harvestingWorkerCount,
    reconCount,
    extractorCount,
    turretCount,
    factoryCount,
    powerPlantCount,
    pylonCount,
    depotCount,
    avgBuildingHpRatio: bHpMax > 0 ? bHp / bHpMax : 1,
    damagedBuilding,
    idleUnits,
    nearestEnemy,
  };
}
