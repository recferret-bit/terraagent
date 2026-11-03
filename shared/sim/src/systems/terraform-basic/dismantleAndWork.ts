import type { RejectCode, ResourceKey } from '@terra/contracts';
import type { WorkIntent } from '@terra/contracts/commands/enqueue-task';
import { compileData } from '../../data';
import { DISMANTLE_REFUND_RATE, REPAIR_COST_RATE, TERRAFORM_TIME_TABLE } from '../../data/ops-basic';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { removeRow } from '../../ecs/store';
import { hexDistance, hexIndex } from '../../grid/hex';
import { bumpPathEpoch } from '../../grid/tileModel';
import type { CompiledDataLike } from '../../kernel/config';
import { setBlob, type PlanetState, type SimState } from '../../kernel/state';
import { isUnitKind } from '../../units/mobility';
import { buildingKindName, demolishBuilding, getFootprintTileIndices, resolveBuildingRow } from '../economy/construction';
import { refundCost } from '../economy/ledger';
import { cancelHarvesterTask, resolveHarvesterRow, withoutUnitView } from '../harvest';
import {
  ensureWorkColony as ensureColony,
  getWorkJobsMap,
  hasActiveWorkJobForWorker,
  hasWorkJob,
  saveWorkJobsMap,
  type WorkJobRecord,
} from './workJobs';
import { classifyGroundWorkTile, createGroundWorkJob, primeWorkerForWorkJob, selectWorkerForWorkOp } from './workTile';

export {
  cancelWorkerJobs, cancelWorkJobs, getWorkJobsMap, hasActiveWorkJobForWorker, hasWorkJob, saveWorkJobsMap, workJobDrawPerS, type WorkJobRecord,
} from './workJobs';
export { classifyGroundWorkTile } from './workTile';
export { workJobsSystem } from './workSystem';

/** The base build cost of an entity kind (repair is priced and dismantle refunded from it); the client preview reads it too. */
export function getEntityBaseBuildCost(kind: number, data?: CompiledDataLike): Partial<Record<ResourceKey, number>> {
  const src = data ?? compileData(new Set(['W00', 'W01', 'W02', 'W10']));
  if (kind === ENTITY_KIND.harvester) return ((resolveHarvesterRow(src).cost ?? { 'metals.t1': 70, 'minerals.t1': 30 }) as Partial<Record<ResourceKey, number>>);
  if (kind === ENTITY_KIND.hq) return { 'metals.t1': 100, 'minerals.t1': 50 };
  const resolved = resolveBuildingRow(buildingKindName(kind), src);
  return ((resolved?.row.cost ?? { 'metals.t1': 50, 'minerals.t1': 25 }) as Partial<Record<ResourceKey, number>>);
}

/** Finds player-owned entities at `(q, r)` for `colonyId` (non-HQ entities sorted before HQ/CommandHub). */
export function findOwnEntitiesAtTile(
  state: SimState,
  colonyId: number,
  q: number,
  r: number,
  data?: CompiledDataLike,
  preferredEntityId?: number,
): number[] {
  const e = state.entities, cols = e.cols;
  const matches: number[] = [];
  for (let row = 0; row < e.count; row++) {
    if (cols.owner[row] !== colonyId || cols.hp[row] <= 0) continue;
    const id = cols.id[row];
    if (preferredEntityId !== undefined && id === preferredEntityId) {
      matches.unshift(row);
      continue;
    }
    const kind = cols.kind[row];
    if (isUnitKind(kind)) {
      if ((Math.round(cols.q[row]) === q && Math.round(cols.r[row]) === r) || hexDistance(cols.q[row], cols.r[row], q, r) < 0.6) {
        matches.push(row);
      }
    } else if (kind === ENTITY_KIND.pod) {
      // The landed pod (the wreck) is one hex and can be scrapped: it matches its own tile only.
      if (cols.state[row] !== ENTITY_STATE.descending && Math.round(cols.q[row]) === q && Math.round(cols.r[row]) === r) matches.push(row);
    } else {
      const defFp =
        kind === ENTITY_KIND.commandHub
          ? 3
          : kind === ENTITY_KIND.metalsExtractor || kind === ENTITY_KIND.solar || kind === ENTITY_KIND.tradeHub
            ? 2
            : 1;
      const w = Math.max(1, cols.footprintW[row] || defFp);
      const d = Math.max(1, cols.footprintD[row] || defFp);
      const fp = getFootprintTileIndices(state as PlanetState, cols.q[row], cols.r[row], w, d, cols.rot[row]);
      const tIdx = hexIndex(state.grid.radius).indexOf(q, r);
      if ((tIdx >= 0 && fp.indices.includes(tIdx)) || (cols.q[row] === q && cols.r[row] === r)) {
        matches.push(row);
      }
    }
  }
  // Others first, then the pod (the HQ Drone stands on it right after landing), the protected HQ / Hub last.
  const rank = (row: number): number => cols.kind[row] === ENTITY_KIND.hq || cols.kind[row] === ENTITY_KIND.commandHub ? 2 : cols.kind[row] === ENTITY_KIND.pod ? 1 : 0;
  matches.sort((a, b) => rank(a) - rank(b));
  return matches;
}

/** Whether `colonyId` owns an alive, finished Command Hub (either hub kind). */
export function colonyHasActiveHub(state: SimState, colonyId: number): boolean {
  const e = state.entities, cols = e.cols;
  for (let row = 0; row < e.count; row++) {
    const k = cols.kind[row];
    if (cols.owner[row] === colonyId && (k === ENTITY_KIND.hub || k === ENTITY_KIND.commandHub) && cols.hp[row] > 0 && cols.state[row] === ENTITY_STATE.active) return true;
  }
  return false;
}

/**
 * Dismantles a player-owned building or unit at `(q, r)` (`op: 'dismantle'`):
 * - Rejects Command Hub (`ENTITY_KIND.commandHub`) and HQ Drone (`ENTITY_KIND.hq`) with `'cannot_dismantle_hq'`.
 * - Removes any other player-owned building or unit, freeing footprint tiles and supply, and refunds 50% of spent/base cost.
 */
export function executeDismantleAtTile(
  state: SimState,
  colonyId: number,
  q: number,
  r: number,
  tick: number = state.meta.tick,
  data?: CompiledDataLike,
  preferredEntityId?: number,
): { ok: true; entityId: number; refunded: Partial<Record<ResourceKey, number>> } | { ok: false; reason: RejectCode } {
  const rows = findOwnEntitiesAtTile(state, colonyId, q, r, data, preferredEntityId);
  if (rows.length === 0) return { ok: false, reason: 'site_blocked' };

  const targetRow = rows[0]!;
  const cols = state.entities.cols;
  const kind = cols.kind[targetRow];
  const entityId = cols.id[targetRow];

  if (kind === ENTITY_KIND.commandHub || kind === ENTITY_KIND.hq) {
    return { ok: false, reason: 'cannot_dismantle_hq' };
  }

  if (kind === ENTITY_KIND.pod) {
    // The pod is the colony's reference until its Hub stands: the pre-Hub terraform radius and the Hub's landing distance
    // read it. So it is scrapped only once the colony has an active Hub (reject `site_blocked` before).
    if (!colonyHasActiveHub(state, colonyId)) return { ok: false, reason: 'site_blocked' };
    removeRow(state.entities, entityId, tick);
    bumpPathEpoch(state.meta);
    return { ok: true, entityId, refunded: {} };
  }

  if (!isUnitKind(kind)) {
    const res = demolishBuilding(state as PlanetState, entityId, colonyId, tick, data);
    if (!res.ok) return { ok: false, reason: (res.code as RejectCode) ?? 'site_blocked' };
    return { ok: true, entityId, refunded: res.refunded };
  }

  const colony = ensureColony(state, colonyId, tick);
  const baseCost = getEntityBaseBuildCost(kind, data);
  refundCost(colony, baseCost, DISMANTLE_REFUND_RATE, tick);
  const refunded: Partial<Record<ResourceKey, number>> = {};
  for (const [k, v] of Object.entries(baseCost) as [ResourceKey, number][]) {
    if (v && v > 0) refunded[k] = v * DISMANTLE_REFUND_RATE;
  }

  cancelHarvesterTask(state as PlanetState, entityId, tick);
  // Drop its views from the colony lists (by `entityId`: a `delete list[i]` would leave a hole the codec saves as null).
  if (Array.isArray(colony.harvesters)) colony.harvesters = withoutUnitView(colony.harvesters, entityId);
  if (Array.isArray(colony.units)) colony.units = withoutUnitView(colony.units, entityId);
  const prevUnits = (state.blobs.units?.value as Record<string, unknown> | undefined) ?? {};
  const byId = { ...((prevUnits.byId as Record<string, unknown> | undefined) ?? {}) };
  delete byId[String(entityId)];
  const nextUnits: Record<string, unknown> = { ...prevUnits, byId };
  delete nextUnits[String(entityId)];
  setBlob(state, 'units', nextUnits, tick);

  removeRow(state.entities, entityId, tick);
  return { ok: true, entityId, refunded };
}

/**
 * Enqueues a simplified `work` job at `(q, r)` (`op: 'work'`, available to both HQ Drone and Harvester):
 * - Case A: Target tile `(q, r)` has a damaged friendly unit or building (`hp < hpMax`) -> starts a repair job at 40% base cost scaled by missing HP.
 * - Case B: Target tile `(q, r)` is un-terraformed ground (`forest`, `rock`, `slope`, `hole`, or wild `flat`) -> starts a terraforming job using `TERRAFORM_TIME_TABLE` and `RESOURCE_INCOME_TABLE`.
 * `intent: 'repair'` allows only case A (no damaged target → `site_blocked`), `'terraform'` only case B; absent = A else B.
 * `chain`: a terraform job continues on the nearest obstacles when done (`chain.ts`; repair never chains).
 */
export function enqueueWorkAtTile(
  state: SimState,
  colonyId: number,
  q: number,
  r: number,
  opts?: {
    workerId?: number; entityId?: number; taskId?: string; tick?: number; data?: CompiledDataLike; intent?: WorkIntent; chain?: boolean;
    /** The order (command) id when it differs from `taskId` (a multi-tile order): `cancelTask` by it ends every job. */
    chainRootId?: string;
  },
): { ok: true; job: WorkJobRecord } | { ok: false; reason: RejectCode } {
  const tick = opts?.tick ?? state.meta.tick;
  const tileIdx = hexIndex(state.grid.radius).indexOf(q, r);
  if (tileIdx < 0) return { ok: false, reason: 'invalid_args' };
  const rootOf = opts?.chainRootId !== undefined ? { chainRootId: opts.chainRootId } : {};

  const cols = state.entities.cols;
  const ownRows = opts?.intent === 'terraform' ? [] : findOwnEntitiesAtTile(state, colonyId, q, r, opts?.data, opts?.entityId);
  const damagedRow = ownRows.find((row) => cols.hp[row] > 0 && cols.hp[row] < cols.hpMax[row]);
  if (damagedRow === undefined && opts?.intent === 'repair') return { ok: false, reason: 'site_blocked' };

  if (damagedRow !== undefined) {
    const targetId = cols.id[damagedRow];
    const workerId = selectWorkerForWorkOp(state, colonyId, cols.q[damagedRow], cols.r[damagedRow], opts?.workerId, targetId);
    if (workerId === null) return { ok: false, reason: 'site_blocked' };
    const hpMax = cols.hpMax[damagedRow], startHp = cols.hp[damagedRow];
    const missingFraction = Math.max(0, (hpMax - startHp) / Math.max(1, hpMax));
    const baseCost = getEntityBaseBuildCost(cols.kind[damagedRow], opts?.data);
    const totalCost: Partial<Record<ResourceKey, number>> = {};
    for (const [k, v] of Object.entries(baseCost) as [ResourceKey, number][]) {
      if (v && v > 0) totalCost[k] = Number((v * REPAIR_COST_RATE * missingFraction).toFixed(6));
    }
    const durationTicks = Math.max(1, Math.round(TERRAFORM_TIME_TABLE.repair.durationTicks * missingFraction));
    const jobId = opts?.taskId ?? `work-repair-${colonyId}-${tick}-${targetId}`;
    const job: WorkJobRecord = {
      jobId, colonyId, mode: 'repair', workerEntityId: workerId, targetEntityId: targetId,
      q: cols.q[damagedRow], r: cols.r[damagedRow], tileIdx, durationTicks, elapsedTicks: 0, progress: 0,
      startHp, hpMax, energyCost: 0, yields: {}, totalCost, spentCost: {}, status: 'in_progress', ...rootOf,
    };
    return storeWorkJob(state, job, tick, opts?.data);
  }

  const ground = classifyGroundWorkTile(state, colonyId, tileIdx, { data: opts?.data });
  if (!ground.ok) return ground;
  const workerId = selectWorkerForWorkOp(state, colonyId, q, r, opts?.workerId);
  if (workerId === null) return { ok: false, reason: 'site_blocked' };

  const jobId = opts?.taskId ?? `work-tf-${colonyId}-${tick}-${q},${r}`;
  const job = createGroundWorkJob(jobId, colonyId, workerId, { q, r, tileIdx }, ground);
  if (opts?.chain) Object.assign(job, { chain: true, chainSeq: 0 }, rootOf);
  return storeWorkJob(state, job, tick, opts?.data);
}

/**
 * Stores a new job (an id that names an open job is rejected: never overwrite one, e.g. another colony's). A worker
 * with no job yet is pointed at it now; one that already has jobs works them in order (insertion order, one at a time),
 * so the new job waits behind them.
 */
function storeWorkJob(
  state: SimState,
  job: WorkJobRecord,
  tick: number,
  data?: CompiledDataLike,
): { ok: true; job: WorkJobRecord } | { ok: false; reason: RejectCode } {
  if (hasWorkJob(state, job.jobId)) return { ok: false, reason: 'invalid_args' };
  const busy = hasActiveWorkJobForWorker(state, job.workerEntityId);
  const jobs = getWorkJobsMap(state);
  jobs[job.jobId] = job;
  saveWorkJobsMap(state, jobs, tick);
  if (!busy) primeWorkerForWorkJob(state as PlanetState, job.workerEntityId, job.q, job.r, tick, data);
  return { ok: true, job };
}
