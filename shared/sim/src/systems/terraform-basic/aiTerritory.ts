import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { hexDistance, hexIndex } from '../../grid/hex';
import { DEPOSIT, PREP, TERRAIN } from '../../grid/layers';
import type { CompiledDataLike } from '../../kernel/config';
import type { PlanetState } from '../../kernel/state';
import { occupiedGroundTiles } from '../construction/occupancy';
import { constructionOrdersOf } from '../construction/orders';
import { placementWorldFromState } from '../construction/placementWorld';
import { inPowerZone, placementPowerZoneSources, powerZoneActive } from '../construction/powerZone';
import { buildGapField } from '../construction/siteSpacing';
import { readyBuildingJobs } from '../economy/buildJob';
import { getFootprintTileIndices, resolveBuildingRow } from '../economy/buildingRows';
import { checkCostAffordability } from '../economy/ledger';
import { getColonyPower } from '../power-core';
import { checkItemUnlockStage, resolveEffectiveUnlockStage } from '../progression/validate';
import { chainStandRule, isChainObstacle } from './chain';
import { colonyHasActiveHub } from './dismantleAndWork';
import { getWreckTileSet } from '../combat/wrecks';
import { evaluateGroundWorkTile } from './groundWorkRule';
import { colonyTerraformOrders } from './orders';
import { resolveCultivateTileOp, terraformWorldFromState, type CultivateOpKind } from './rules';
import { getWorkJobsMap } from './workJobs';

export interface TerritoryObstacleTarget {
  q: number;
  r: number;
  tileIdx: number;
  terrainKey: string;
}

export interface TerritoryCultivateTarget {
  q: number;
  r: number;
  tileIdx: number;
  op: CultivateOpKind;
}

export interface AvailableTerraformBuilder {
  ok: boolean;
  workerId: number | null;
}

interface QueueEntryLike {
  colonyIndex?: number;
  lane?: string;
  state?: string;
  task?: { kind?: string; building?: string; q?: number; r?: number; rotation?: number };
}

function findColonyAnchorLocal(state: PlanetState, colonyIndex: number): { q: number; r: number } {
  const { count, cols } = state.entities;
  let podPos: { q: number; r: number } | null = null;
  let hqPos: { q: number; r: number } | null = null;
  for (let row = 0; row < count; row++) {
    if (cols.owner[row] !== colonyIndex) continue;
    if (cols.hp[row] <= 0 && cols.hpMax[row] > 0) continue;
    const kind = cols.kind[row];
    if (kind === ENTITY_KIND.commandHub) return { q: cols.q[row], r: cols.r[row] };
    if (kind === ENTITY_KIND.pod && !podPos) podPos = { q: cols.q[row], r: cols.r[row] };
    else if (kind === ENTITY_KIND.hq && !hqPos) hqPos = { q: cols.q[row], r: cols.r[row] };
  }
  return podPos ?? hqPos ?? { q: 0, r: 0 };
}

function readConstructionQueueBuilds(state: PlanetState, colonyIndex: number): QueueEntryLike[] {
  const raw = (state.blobs.queue?.value as { entries?: ReadonlyArray<QueueEntryLike> } | undefined)?.entries;
  if (!Array.isArray(raw)) return [];
  const out: QueueEntryLike[] = [];
  for (const entry of raw) {
    if (
      entry.colonyIndex === colonyIndex &&
      (!entry.lane || entry.lane === 'construction') &&
      entry.state !== 'done' &&
      entry.state !== 'cancelled' &&
      entry.task?.kind === 'build'
    ) {
      out.push(entry);
    }
  }
  return out;
}

function collectReservedTileSet(
  state: PlanetState,
  colonyIndex: number,
  data?: CompiledDataLike,
): Set<number> {
  const reserved = new Set<number>(occupiedGroundTiles(state, data));
  for (const entry of readConstructionQueueBuilds(state, colonyIndex)) {
    const building = entry.task?.building;
    const q = entry.task?.q;
    const r = entry.task?.r;
    if (typeof building !== 'string' || typeof q !== 'number' || typeof r !== 'number') continue;
    const resolved = resolveBuildingRow(building, data);
    const w = Number(resolved?.row.footprintW ?? resolved?.row.footprint ?? 2);
    const d = Number(resolved?.row.footprintD ?? resolved?.row.footprint ?? 2);
    const fp = getFootprintTileIndices(state, q, r, w, d, entry.task?.rotation ?? 0);
    for (const idx of fp.indices) reserved.add(idx);
  }
  for (const order of constructionOrdersOf(state.blobs.constructionQueue?.value, colonyIndex)) {
    if (order.status === 'completed' || order.status === 'cancelled') continue;
    const resolved = resolveBuildingRow(order.building, data);
    const w = Number(resolved?.row.footprintW ?? resolved?.row.footprint ?? 3);
    const d = Number(resolved?.row.footprintD ?? resolved?.row.footprint ?? 3);
    const fp = getFootprintTileIndices(state, order.q, order.r, w, d, 0);
    for (const idx of fp.indices) reserved.add(idx);
  }
  return reserved;
}

function hasOpenTerraformZoneGoal(state: PlanetState, colonyIndex: number): boolean {
  const rawBlob = state.blobs.goals?.value;
  let blobList: unknown;
  if (rawBlob && typeof rawBlob === 'object') {
    const obj = rawBlob as Record<string, unknown>;
    const mapSource = obj.byColony && typeof obj.byColony === 'object' ? (obj.byColony as Record<string, unknown>) : obj;
    blobList = mapSource[String(colonyIndex)];
  }
  const list = Array.isArray(blobList) ? blobList : state.colonies[colonyIndex]?.goals;
  if (!Array.isArray(list)) return false;
  for (const g of list as ReadonlyArray<{ goal?: string; status?: string }>) {
    if (g.goal === 'terraform_zone' && (g.status === 'queued' || g.status === 'active')) {
      return true;
    }
  }
  return false;
}

/**
 * Checks whether `colonyIndex` has a builder (Worker Drone preferred, else idle HQ) available for
 * territory terraforming without starving active construction or brownout power recovery.
 */
export function hasAvailableTerraformBuilder(
  state: PlanetState,
  colonyIndex: number,
  opts?: { reserveHarvestWorker?: boolean },
): AvailableTerraformBuilder {
  if (getColonyPower(state, colonyIndex).brownout) return { ok: false, workerId: null };

  const busyWorkers = new Set<number>();
  for (const job of Object.values(getWorkJobsMap(state))) {
    if (job.colonyId === colonyIndex) busyWorkers.add(job.workerEntityId);
  }

  const readyW02 = readyBuildingJobs(state, colonyIndex).length;
  const readyW01 = constructionOrdersOf(state.blobs.constructionQueue?.value, colonyIndex).filter(
    (o) => o.status === 'in_progress',
  ).length;
  const readyBuildCount = readyW02 + readyW01;

  const { count, cols } = state.entities;
  const idleWorkers: number[] = [];
  const harvestingWorkers: number[] = [];
  let freeHqId: number | null = null;

  for (let row = 0; row < count; row++) {
    if (cols.owner[row] !== colonyIndex || cols.hp[row] <= 0) continue;
    const kind = cols.kind[row];
    const st = cols.state[row];
    if (
      st === ENTITY_STATE.constructing ||
      st === ENTITY_STATE.descending ||
      st === ENTITY_STATE.working ||
      st === ENTITY_STATE.offlineBrownout ||
      st === ENTITY_STATE.offlineUnpowered
    ) {
      continue;
    }
    const id = cols.id[row];
    if (busyWorkers.has(id)) continue;
    if (kind === ENTITY_KIND.worker) {
      if (st === ENTITY_STATE.harvesting) harvestingWorkers.push(id);
      else idleWorkers.push(id);
    } else if (kind === ENTITY_KIND.hq) {
      freeHqId = id;
    }
  }

  const allowHarvestPull = !opts?.reserveHarvestWorker || harvestingWorkers.length >= 2;
  const usableWorkers = allowHarvestPull ? [...idleWorkers, ...harvestingWorkers] : idleWorkers;
  const totalFree = usableWorkers.length + (freeHqId !== null ? 1 : 0);
  if (totalFree <= readyBuildCount) return { ok: false, workerId: null };

  if (idleWorkers.length > 0) return { ok: true, workerId: idleWorkers[0]! };
  if (freeHqId !== null && readyBuildCount === 0) return { ok: true, workerId: freeHqId };
  if (usableWorkers.length > 0) return { ok: true, workerId: usableWorkers[0]! };
  return { ok: false, workerId: null };
}

function collectPendingTerraformTiles(state: PlanetState, colonyIndex: number): Set<string> {
  const out = new Set<string>();
  for (const job of Object.values(getWorkJobsMap(state))) {
    if (job.colonyId === colonyIndex && job.mode === 'terraform') out.add(`${job.q},${job.r}`);
  }
  for (const order of colonyTerraformOrders(state, colonyIndex)) {
    for (const j of order.jobs) out.add(`${j.q},${j.r}`);
  }
  return out;
}

function collectNearDepositSet(state: PlanetState, anchor: { q: number; r: number }, maxRadius: number): Set<number> {
  const hx = hexIndex(state.grid.radius);
  const deposit = state.grid.layers.deposit;
  const out = new Set<number>();
  if (!deposit) return out;
  for (let i = 0; i < state.grid.count; i++) {
    if (deposit[i] === DEPOSIT.none) continue;
    const dq = hx.q[i]!;
    const dr = hx.r[i]!;
    if (hexDistance(anchor.q, anchor.r, dq, dr) > maxRadius + 2) continue;
    for (let rr = -2; rr <= 2; rr++) {
      for (let qq = -2; qq <= 2; qq++) {
        if (hexDistance(0, 0, qq, rr) > 2) continue;
        const ni = hx.indexOf(dq + qq, dr + rr);
        if (ni >= 0) out.add(ni);
      }
    }
  }
  return out;
}

function canAffordGroundCost(state: PlanetState, colonyIndex: number, cost: Partial<Record<string, number>>): boolean {
  if (Object.keys(cost).length === 0) return true;
  const colony = state.colonies[colonyIndex];
  if (!colony) return false;
  return checkCostAffordability(colony, cost).ok;
}

/**
 * Finds the highest-priority obstacle inside (or pre-Hub near) `colonyIndex`'s territory that a worker/HQ
 * can reach and clear from the edge inward to widen building corridors and reclaim usable territory.
 */
export function findTerritoryObstacleToClear(
  state: PlanetState,
  colonyIndex: number,
  opts?: { maxRadius?: number; data?: CompiledDataLike; workerId?: number; includeWildFlat?: boolean },
): TerritoryObstacleTarget | null {
  const anchor = findColonyAnchorLocal(state, colonyIndex);
  const maxRadius = opts?.maxRadius ?? 10;
  const workerId = opts?.workerId ?? hasAvailableTerraformBuilder(state, colonyIndex).workerId;
  const stand = workerId !== null ? chainStandRule(state, workerId, opts?.data) : null;
  const world = terraformWorldFromState(state, colonyIndex, opts?.data);
  const reserved = collectReservedTileSet(state, colonyIndex, opts?.data);
  const gaps = buildGapField(state.grid.radius, reserved);
  const pendingTiles = collectPendingTerraformTiles(state, colonyIndex);
  const wrecks = getWreckTileSet(state);
  const nearDeposits = collectNearDepositSet(state, anchor, maxRadius);
  const hx = hexIndex(state.grid.radius);
  const { terrain, prep, deposit, height, owner } = state.grid.layers;

  let best: (TerritoryObstacleTarget & { key: readonly number[] }) | null = null;
  for (let i = 0; i < state.grid.count; i++) {
    const q = hx.q[i]!;
    const r = hx.r[i]!;
    const dist = hexDistance(anchor.q, anchor.r, q, r);
    if (dist > maxRadius) continue;
    if (pendingTiles.has(`${q},${r}`) || reserved.has(i)) continue;

    const isObstacle = isChainObstacle(state.grid.radius, i, terrain, height, wrecks);
    const isWildFlat = opts?.includeWildFlat !== false && terrain[i] === TERRAIN.flat && prep[i] === PREP.wild;
    if (!isObstacle && !isWildFlat) continue;
    if (stand && !stand(i)) continue;

    const ground = evaluateGroundWorkTile(world, colonyIndex, i, q, r, {
      deposit,
      occupied: false,
      weather: state.blobs?.weather,
      data: opts?.data,
    });
    if (!ground.ok || ground.terrainKey === 'pod') continue;
    if (!canAffordGroundCost(state, colonyIndex, ground.totalCost)) continue;

    const obstacleTier = isObstacle ? 0 : 1;
    const corridorTier = gaps[i]! <= 2 ? 0 : nearDeposits.has(i) ? 1 : 2;
    const ownedTier = owner[i] === colonyIndex ? 0 : 1;
    const key = [obstacleTier, corridorTier, ownedTier, dist, i] as const;

    if (
      !best ||
      key[0] < best.key[0] ||
      (key[0] === best.key[0] &&
        (key[1] < best.key[1] ||
          (key[1] === best.key[1] &&
            (key[2] < best.key[2] ||
              (key[2] === best.key[2] && (key[3] < best.key[3] || (key[3] === best.key[3] && key[4] < best.key[4])))))))
    ) {
      best = { q, r, tileIdx: i, terrainKey: ground.terrainKey, key };
    }
  }

  return best ? { q: best.q, r: best.r, tileIdx: best.tileIdx, terrainKey: best.terrainKey } : null;
}

function canAffordCultivateReserve(state: PlanetState, colonyIndex: number, op: CultivateOpKind): boolean {
  const stock = (state.colonies[colonyIndex] as { stock?: Record<string, number> } | undefined)?.stock;
  const water = Number(stock?.['bio.water'] ?? 0);
  const minerals = Number(stock?.['minerals.t1'] ?? 0);
  const desert = String(state.meta.planetType ?? '') === 'desert';
  if (op === 'grade') return minerals >= 4;
  if (op === 'irrigate') return water >= (desert ? 45 : 30);
  return water >= 25 && minerals >= 15;
}

/**
 * Picks an owned level flat tile to advance through `grade -> irrigate -> seed -> living` while holding
 * minimum resource reserves and queueing at most one manual terraform order at a time.
 */
export function findTerritoryTileToCultivate(
  state: PlanetState,
  colonyIndex: number,
  opts?: { maxRadius?: number; data?: CompiledDataLike },
): TerritoryCultivateTarget | null {
  if (getColonyPower(state, colonyIndex).brownout) return null;
  if (colonyTerraformOrders(state, colonyIndex).length > 0) return null;
  if (hasOpenTerraformZoneGoal(state, colonyIndex)) return null;

  const anchor = findColonyAnchorLocal(state, colonyIndex);
  const maxRadius = opts?.maxRadius ?? 10;
  const world = terraformWorldFromState(state, colonyIndex, opts?.data);
  const reserved = collectReservedTileSet(state, colonyIndex, opts?.data);
  const gaps = buildGapField(state.grid.radius, reserved);
  const pendingTiles = collectPendingTerraformTiles(state, colonyIndex);
  const hx = hexIndex(state.grid.radius);
  const { owner, deposit } = state.grid.layers;

  let best: (TerritoryCultivateTarget & { key: readonly number[] }) | null = null;
  for (let i = 0; i < state.grid.count; i++) {
    if (owner[i] !== colonyIndex || reserved.has(i)) continue;
    const q = hx.q[i]!;
    const r = hx.r[i]!;
    const dist = hexDistance(anchor.q, anchor.r, q, r);
    if (dist > maxRadius) continue;
    if (pendingTiles.has(`${q},${r}`)) continue;

    const cult = resolveCultivateTileOp(world, colonyIndex, q, r, { data: opts?.data, deposit });
    if (!cult.ok) continue;
    if (!canAffordCultivateReserve(state, colonyIndex, cult.op)) continue;

    const opRank = cult.op === 'seed' ? 0 : cult.op === 'irrigate' ? 1 : 2;
    const walkwayTier = gaps[i]! >= 1 && gaps[i]! <= 2 ? 0 : 1;
    const key = [opRank, walkwayTier, dist, i] as const;

    if (
      !best ||
      key[0] < best.key[0] ||
      (key[0] === best.key[0] &&
        (key[1] < best.key[1] ||
          (key[1] === best.key[1] && (key[2] < best.key[2] || (key[2] === best.key[2] && key[3] < best.key[3])))))
    ) {
      best = { q, r, tileIdx: i, op: cult.op, key };
    }
  }

  return best ? { q: best.q, r: best.r, tileIdx: best.tileIdx, op: best.op } : null;
}

/**
 * Pure check for whether `colonyIndex` should expand its power zone with a `pylon` (without site selection,
 * so lower sim layers can evaluate power-zone pressure without importing higher placement pickers).
 */
export function needsPowerZoneExpansion(
  state: PlanetState,
  colonyIndex: number,
  data?: CompiledDataLike,
  flags?: { has(w: string): boolean },
  opts?: { noSpaciousSite?: boolean },
): boolean {
  if (!powerZoneActive(data) || !colonyHasActiveHub(state, colonyIndex)) {
    return false;
  }
  if (flags) {
    if (!checkItemUnlockStage(state, colonyIndex, 'pylon', flags, data).ok) return false;
  } else {
    const col = state.colonies[colonyIndex];
    const hasStage = typeof col?.stage === 'number' || typeof col?.unlockStage === 'number';
    if (hasStage && resolveEffectiveUnlockStage(state, colonyIndex) < 2) {
      return false;
    }
  }

  if (readConstructionQueueBuilds(state, colonyIndex).some((e) => e.task?.building === 'pylon')) {
    return false;
  }

  const { count, cols } = state.entities;
  let pylonCount = 0;
  let buildingCount = 0;
  for (let row = 0; row < count; row++) {
    if (cols.owner[row] !== colonyIndex || cols.hp[row] <= 0) continue;
    const k = cols.kind[row];
    if (k === ENTITY_KIND.pylon) {
      pylonCount++;
      if (cols.state[row] === ENTITY_STATE.constructing || cols.state[row] === ENTITY_STATE.waiting) {
        return false;
      }
    } else if (
      k !== ENTITY_KIND.worker &&
      k !== ENTITY_KIND.hq &&
      k !== ENTITY_KIND.pod &&
      k !== ENTITY_KIND.recon &&
      k !== ENTITY_KIND.demoTank &&
      k !== ENTITY_KIND.demoArtillery &&
      k !== ENTITY_KIND.devProbe
    ) {
      buildingCount++;
    }
  }

  if (pylonCount >= 4) return false;

  const world = placementWorldFromState(state);
  const sources = placementPowerZoneSources(world, colonyIndex, data);
  const anchor = findColonyAnchorLocal(state, colonyIndex);
  const hx = hexIndex(state.grid.radius);
  const { owner, deposit, richness } = state.grid.layers;
  const reserved = collectReservedTileSet(state, colonyIndex, data);
  let hasUncoveredDeposit = false;

  for (let i = 0; i < state.grid.count; i++) {
    if (deposit[i] === DEPOSIT.none || reserved.has(i)) continue;
    if (richness && richness[i]! <= 0) continue;
    const own = owner[i];
    if (own >= 0 && own !== colonyIndex) continue;
    const q = hx.q[i]!;
    const r = hx.r[i]!;
    if (hexDistance(anchor.q, anchor.r, q, r) > 10) continue;
    if (own === colonyIndex && !inPowerZone(sources, q, r)) {
      hasUncoveredDeposit = true;
      break;
    }
  }

  const needsBySize = buildingCount >= 4 && pylonCount < Math.min(4, Math.floor(buildingCount / 3));
  return Boolean(opts?.noSpaciousSite) || hasUncoveredDeposit || needsBySize;
}
