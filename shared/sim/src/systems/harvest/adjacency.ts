import {
  RESOURCE_FAMILIES,
  type ResourceFamily,
  type ResourceKey,
} from '@terra/contracts';
import { ENTITY_STATE } from '../../ecs/columns';
import { rowOf, setField } from '../../ecs/store';
import { HEX_DIRS, hexDistance, hexIndex } from '../../grid/hex';
import { DEPOSIT, PREP, TERRAIN } from '../../grid/layers';
import type { StepContext } from '../../kernel/context';
import { setBlob, type PlanetState } from '../../kernel/state';
import { UnitBook } from '../../units/book';
import { faceTowards } from '../../units/movement/locomotion';
import { cancelMove, requestMove } from '../../units/movement/orchestrator';
import { occupiedGroundTiles } from '../construction/occupancy';
import { ensureColonyLedger, familyStock, isFamilyAtCap, type ColonyWithLedger } from '../economy/ledger';
import { isCrewKind, isWorker } from './unit';
import { syncHarvestWorkerView } from './workers';

export type HarvestWeights = Record<ResourceFamily, number>;

export interface WorkerTargetAssignment {
  entityId: number;
  mode: 'harvest' | 'clear' | 'break' | 'work' | 'repair';
  tileIdx: number;
  q: number;
  r: number;
  standQ?: number;
  standR?: number;
  family?: ResourceFamily;
  resourceKey?: ResourceKey;
  playerAssigned?: boolean;
  repairEntityId?: number;
  totalCost?: Partial<Record<ResourceKey, number>>;
  spentCost?: Partial<Record<ResourceKey, number>>;
  startHp?: number;
  elapsedTicks: number;
  requiredTicks: number;
}

export const HARVEST_CYCLE_TICKS = 20;

const OIL_KEY_BY_TIER: Record<1 | 2 | 3, ResourceKey> = { 1: 'bio.biomass', 2: 'bio.t2', 3: 'bio.t3' };

/**
 * The family and stock key a deposit yields, by its `deposit` code and `depositTier` (0 = legacy → tier 1): metals →
 * `metals.t{tier}`, minerals → `minerals.t{tier}`, oil → `bio.biomass` / `bio.t2` / `bio.t3`.
 */
export function depositFamilyAndKey(depositCode: number, tier = 0): { family: ResourceFamily; key: ResourceKey } | null {
  const t: 1 | 2 | 3 = tier === 2 || tier === 3 ? tier : 1;
  if (depositCode === DEPOSIT.metals) return { family: 'metals', key: `metals.t${t}` };
  if (depositCode === DEPOSIT.minerals) return { family: 'minerals', key: `minerals.t${t}` };
  if (depositCode === DEPOSIT.oil) return { family: 'bio', key: OIL_KEY_BY_TIER[t] };
  return null;
}

/** The deposit info of tile `i` (its code and tier layer). */
const tileDepositInfo = (state: PlanetState, i: number) =>
  depositFamilyAndKey(state.grid.layers.deposit[i], (state.grid.layers.depositTier as Uint8Array | undefined)?.[i] ?? 0);

/**
 * Whether a unit may stand on `tileIdx` next to a deposit: no building footprint (`occupied`, the alive buildings'
 * tiles; build it once with `occupiedGroundTiles` when testing many tiles), no deposit, walkable ground.
 */
export function isPassableAdjacentHex(state: PlanetState, tileIdx: number, occupied: ReadonlySet<number> = occupiedGroundTiles(state)): boolean {
  if (tileIdx < 0 || tileIdx >= state.grid.count) return false;
  const { terrain, prep, deposit } = state.grid.layers;
  if (occupied.has(tileIdx)) return false;
  if (deposit[tileIdx] !== DEPOSIT.none) return false;
  const t = terrain[tileIdx];
  const p = prep[tileIdx];
  if (t === TERRAIN.deep || t === TERRAIN.shallow || t === TERRAIN.hole) return false;
  if (p === PREP.ridge || p === PREP.moat) return false;
  return true;
}

/**
 * Picks the closest passable adjacent neighbor hex (`hexDistance === 1`) around `(depQ, depR)`
 * that is not already occupied or reserved by another unit (`entityId !== selfEntityId`).
 */
export function pickFreeAdjacentDepositHex(
  state: PlanetState,
  depQ: number,
  depR: number,
  selfEntityId: number,
  unitQ: number,
  unitR: number,
  assignments?: Record<number, WorkerTargetAssignment>,
  occupied: ReadonlySet<number> = occupiedGroundTiles(state),
): { q: number; r: number; tileIdx: number } | null {
  const idx = hexIndex(state.grid.radius);
  const e = state.entities, cols = e.cols;
  const reserved = new Set<number>();

  for (let r = 0; r < e.count; r++) {
    if (cols.hp[r] <= 0 || cols.id[r] === selfEntityId) continue;
    const k = cols.kind[r];
    if (!isCrewKind(k)) continue;
    const uTile = idx.indexOf(cols.q[r], cols.r[r]);
    if (uTile >= 0 && hexDistance(cols.q[r], cols.r[r], depQ, depR) === 1) {
      reserved.add(uTile);
    }
    const a = assignments?.[cols.id[r]];
    if (a && a.standQ !== undefined && a.standR !== undefined && a.q === depQ && a.r === depR) {
      const sTile = idx.indexOf(a.standQ, a.standR);
      if (sTile >= 0) reserved.add(sTile);
    }
  }

  let best: { q: number; r: number; tileIdx: number; dist: number } | null = null;
  for (const [dq, dr] of HEX_DIRS) {
    const nq = depQ + dq;
    const nr = depR + dr;
    const nIdx = idx.indexOf(nq, nr);
    if (!isPassableAdjacentHex(state, nIdx, occupied)) continue;
    if (reserved.has(nIdx)) continue;
    const dist = hexDistance(unitQ, unitR, nq, nr);
    if (!best || dist < best.dist) {
      best = { q: nq, r: nr, tileIdx: nIdx, dist };
    }
  }
  return best ? { q: best.q, r: best.r, tileIdx: best.tileIdx } : null;
}

export function hasAnyPassableNeighbor(state: PlanetState, q: number, r: number, occupied: ReadonlySet<number> = occupiedGroundTiles(state)): boolean {
  const idx = hexIndex(state.grid.radius);
  for (const [dq, dr] of HEX_DIRS) {
    if (isPassableAdjacentHex(state, idx.indexOf(q + dq, r + dr), occupied)) return true;
  }
  return false;
}

export function pickBestSurfaceDepositForUnit(
  state: PlanetState,
  colony: ColonyWithLedger,
  weights: HarvestWeights,
  unitQ: number,
  unitR: number,
  selfEntityId = -1,
  assignments?: Record<number, WorkerTargetAssignment>,
  occupied: ReadonlySet<number> = occupiedGroundTiles(state),
  goalResource: ResourceKey | null = null,
): { tileIdx: number; q: number; r: number; standQ: number; standR: number; family: ResourceFamily; resourceKey: ResourceKey } | null {
  const familyNeed: Record<ResourceFamily, number> = { metals: 0, minerals: 0, bio: 0 };
  for (const f of RESOURCE_FAMILIES) {
    const w = Math.max(0, weights[f] ?? 100);
    if (w <= 0 || isFamilyAtCap(colony, f)) {
      familyNeed[f] = 0;
    } else {
      const cap = Math.max(1, colony.caps[f] ?? 500);
      const deficit = Math.max(1, cap - familyStock(colony, f));
      familyNeed[f] = w * deficit;
    }
  }

  const { deposit, richness, terrain, prep } = state.grid.layers;
  const idx = hexIndex(state.grid.radius);
  let bestTile = -1;
  let bestNeed = 0;
  let bestDist = Infinity;
  let bestInfo: { family: ResourceFamily; key: ResourceKey } | null = null;
  let bestStand: { q: number; r: number } | null = null;

  for (let i = 0; i < state.grid.count; i++) {
    if (deposit[i] === DEPOSIT.none) continue;
    const info = tileDepositInfo(state, i);
    if (goalResource && info?.key !== goalResource) continue;
    if (!info || occupied.has(i)) continue; // a deposit under a building (an Extractor) is not harvested
    if (Number(richness?.[i] ?? 10000) <= 0) continue;
    if (terrain[i] === TERRAIN.deep || prep[i] === PREP.ridge || prep[i] === PREP.moat) continue;
    const need = familyNeed[info.family];
    if (need <= 0) continue;
    const depQ = idx.q[i], depR = idx.r[i];
    const stand = pickFreeAdjacentDepositHex(state, depQ, depR, selfEntityId, unitQ, unitR, assignments, occupied);
    if (!stand) continue;
    const dist = hexDistance(unitQ, unitR, depQ, depR);
    if (need > bestNeed + 1e-6 || (Math.abs(need - bestNeed) <= 1e-6 && dist < bestDist)) {
      bestNeed = need;
      bestDist = dist;
      bestTile = i;
      bestInfo = info;
      bestStand = stand;
    }
  }

  if (bestTile < 0 || !bestInfo || !bestStand) return null;
  return {
    tileIdx: bestTile,
    q: idx.q[bestTile],
    r: idx.r[bestTile],
    standQ: bestStand.q,
    standR: bestStand.r,
    family: bestInfo.family,
    resourceKey: bestInfo.key,
  };
}

/**
 * Assigns a Worker (`entityId`) to harvest a specific deposit tile `(depQ, depR)` and moves it to the
 * closest free passable neighbor hex (`hexDistance === 1`).
 */
export function assignWorkerDepositTarget(
  state: PlanetState,
  entityId: number,
  depQ: number,
  depR: number,
  tick: number = state.meta.tick,
  ctx?: StepContext,
): { ok: true; standQ: number; standR: number } | { ok: false; code: string } {
  const row = rowOf(state.entities, entityId);
  if (row < 0 || !isWorker(state.entities.cols.kind[row])) return { ok: false, code: 'unknown_entity' };
  const idx = hexIndex(state.grid.radius);
  const tileIdx = idx.indexOf(depQ, depR);
  if (tileIdx < 0) return { ok: false, code: 'invalid_args' };
  const info = tileDepositInfo(state, tileIdx);
  if (!info) return { ok: false, code: 'site_blocked' };

  const rawBlob = (state.blobs.harvest?.value as { weightsByColony?: Record<number, HarvestWeights>; assignments?: Record<number, WorkerTargetAssignment> } | undefined) ?? {};
  const assignments = { ...(rawBlob.assignments ?? {}) };
  const cols = state.entities.cols;
  const stand = pickFreeAdjacentDepositHex(state, depQ, depR, entityId, cols.q[row], cols.r[row], assignments);
  if (!stand) return { ok: false, code: 'site_blocked' };

  const book = new UnitBook(state);
  const rec = book.get(entityId);
  rec.current = null;
  rec.queue = [];
  rec.holdUntil = 0;
  book.touch();
  book.flush(tick);

  const isRich = Number(state.grid.layers.richness?.[tileIdx] ?? 10000) > 0;
  if (isRich) {
    assignments[entityId] = {
      entityId, mode: 'harvest', tileIdx, q: depQ, r: depR,
      standQ: stand.q, standR: stand.r, family: info.family, resourceKey: info.key,
      playerAssigned: true, elapsedTicks: 0, requiredTicks: 0,
    };
  } else {
    delete assignments[entityId];
  }
  setBlob(state, 'harvest', { weightsByColony: rawBlob.weightsByColony ?? {}, assignments }, tick);

  setField(state.entities, row, 'targetQ', depQ, tick);
  setField(state.entities, row, 'targetR', depR, tick);
  const atStand = hexDistance(cols.q[row], cols.r[row], depQ, depR) === 1 && hexDistance(cols.x[row], cols.y[row], stand.q, stand.r) <= 0.15;
  if (atStand && isRich) {
    cancelMove(state, entityId, tick);
    faceTowards(state, row, depQ, depR, tick);
    setField(state.entities, row, 'state', ENTITY_STATE.harvesting, tick);
  } else {
    setField(state.entities, row, 'state', ENTITY_STATE.moving, tick);
    if (ctx) requestMove(state, row, { q: stand.q, r: stand.r, minDist: 0, maxDist: 0 }, ctx);
  }
  if (cols.owner[row] >= 0 && state.colonies[cols.owner[row]]) ensureColonyLedger(state.colonies[cols.owner[row]]);
  syncHarvestWorkerView(state, row, tick, ctx?.data);
  return { ok: true, standQ: stand.q, standR: stand.r };
}
