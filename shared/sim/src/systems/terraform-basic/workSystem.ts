import type { ResourceKey } from '@terra/contracts';
import { ENTITY_STATE } from '../../ecs/columns';
import { rowOf, setField } from '../../ecs/store';
import { hexDistance } from '../../grid/hex';
import { PREP, TERRAIN } from '../../grid/layers';
import { revealSubsurface } from '../../grid/subsurface';
import { setTilePrep, setTileTerrain } from '../../grid/tileModel';
import type { StepContext } from '../../kernel/context';
import type { PlanetState } from '../../kernel/state';
import { defineSystem } from '../../kernel/system';
import { faceTowards } from '../../units/movement/locomotion';
import { cancelMove, requestMove } from '../../units/movement/orchestrator';
import { creditResource, payProgressiveSlice } from '../economy/ledger';
import { continueWorkChain } from './chain';
import { spawnTerraformDeposit } from './resourceSpawn';
import { abandonUnreachableJob } from './unreachable';
import { colonyWho, levelToAdjacentFlat } from './work';
import {
  ensureWorkColony as ensureColony,
  getWorkJobsMap,
  isWorkerAtJob,
  saveWorkJobsMap,
  workReach,
  type WorkJobRecord,
} from './workJobs';
import { classifyGroundWorkTile, syncWorkerView } from './workTile';

/**
 * The work-jobs system (`blobs.workJobs`, construction slot 6): each worker walks to its first job (insertion order)
 * and works it; a finished terraform job continues its chain (`chain.ts`). A worked job draws grid power (power core,
 * slot 7, `power-core/workLoad.ts`); one the brownout shed waits (`power`) with its progress kept until power returns.
 */

/** Ends a job's work on the worker (progress 0, idle). */
function idleWorker(state: PlanetState, workerRow: number, tick: number): void {
  setField(state.entities, workerRow, 'progress', 0, tick);
  setField(state.entities, workerRow, 'state', ENTITY_STATE.idle, tick);
}

function stepRepairWorkJob(state: PlanetState, job: WorkJobRecord, workerRow: number, ctx: StepContext): boolean {
  const e = state.entities, cols = e.cols;
  const targetRow = job.targetEntityId !== undefined ? rowOf(e, job.targetEntityId) : -1;
  if (targetRow < 0 || cols.hp[targetRow] <= 0 || cols.hp[targetRow] >= cols.hpMax[targetRow]) {
    if (targetRow >= 0) setField(e, targetRow, 'progress', 0, ctx.tick);
    idleWorker(state, workerRow, ctx.tick);
    return true;
  }
  const colony = ensureColony(state, job.colonyId, ctx.tick);
  const nextElapsed = job.elapsedTicks + ctx.dt;
  const nextProgress = Math.min(1, nextElapsed / Math.max(1, job.durationTicks));

  if (Object.keys(job.totalCost).length > 0) {
    const pay = payProgressiveSlice(colony, job.totalCost, job.spentCost, nextProgress, ctx.tick);
    if (!pay.ok) {
      job.status = 'waiting';
      job.waitReason = 'resources';
      return false;
    }
  }
  job.status = 'in_progress';
  job.waitReason = undefined;
  job.elapsedTicks = nextElapsed;
  job.progress = nextProgress;

  const hpMax = cols.hpMax[targetRow];
  const newHp = nextProgress >= 1 - 1e-6 ? hpMax : Math.min(hpMax, Math.max(cols.hp[targetRow], Math.round(job.startHp + (hpMax - job.startHp) * nextProgress)));
  setField(e, targetRow, 'hp', newHp, ctx.tick);

  if (nextProgress >= 1 - 1e-6) {
    setField(e, targetRow, 'hp', hpMax, ctx.tick);
    setField(e, targetRow, 'progress', 0, ctx.tick);
    idleWorker(state, workerRow, ctx.tick);
    return true;
  }
  setField(e, workerRow, 'progress', Math.fround(nextProgress), ctx.tick);
  setField(e, targetRow, 'progress', Math.fround(nextProgress), ctx.tick);
  return false;
}

/**
 * Levels the worked ground tile and pays what it held: the fixed yield, the buried deposit (`groundRevealed`), the
 * 1 % deposit roll (`resourceSpawned`). Events carry the concrete op: forest → `obstacleRemoved { op: 'clear' }`,
 * rock → `{ op: 'break' }`, slope / hole / Flat → `tilePrepared` (the W01 order path's event contracts).
 */
function completeGroundWork(state: PlanetState, job: WorkJobRecord, ctx: StepContext): void {
  setTileTerrain(state.grid, job.tileIdx, TERRAIN.flat, ctx.tick);
  setTilePrep(state.grid, job.tileIdx, PREP.prepared, ctx.tick);
  levelToAdjacentFlat(state, job.tileIdx, ctx.tick);
  const { colonyIdStr, who } = colonyWho(state, job.colonyId);
  const found = revealSubsurface(state, job.tileIdx, ctx.tick);
  if (found) ctx.emit({ kind: 'groundRevealed', severity: 'info', colonyIds: [colonyIdStr], data: { ...who, q: job.q, r: job.r, ...found } });

  const colony = ensureColony(state, job.colonyId, ctx.tick);
  for (const [k, v] of Object.entries(job.yields) as [ResourceKey, number][]) {
    if (v && v > 0) creditResource(colony, k, v, ctx.tick);
  }
  const at = { count: 1, q: job.q, r: job.r };
  if (job.terrainKey === 'forest' || job.terrainKey === 'rock') {
    const op = job.terrainKey === 'forest' ? 'clear' : 'break';
    ctx.emit({ kind: 'obstacleRemoved', severity: 'info', colonyIds: [colonyIdStr], data: { ...who, op, ...at } });
  } else {
    ctx.emit({ kind: 'tilePrepared', severity: 'info', colonyIds: [colonyIdStr], data: { ...who, ...at } });
  }
  spawnTerraformDeposit(state, job, who, ctx);
}

/**
 * One step of a ground terraform job. On completion the tile is checked again (GP-01, like the order path): a tile
 * that changed meanwhile (finished by another job, a building placed on it, claimed by another colony, a deposit
 * appeared) is dropped without terrain change or yield. Returns whether the job ended.
 */
function stepGroundWorkJob(state: PlanetState, job: WorkJobRecord, workerRow: number, ctx: StepContext): boolean {
  const nextElapsed = job.elapsedTicks + ctx.dt;
  const nextProgress = Math.min(1, nextElapsed / Math.max(1, job.durationTicks));
  job.elapsedTicks = nextElapsed;
  job.progress = nextProgress;
  if (nextProgress < 1 - 1e-6) {
    setField(state.entities, workerRow, 'progress', Math.fround(nextProgress), ctx.tick);
    return false;
  }
  if (classifyGroundWorkTile(state, job.colonyId, job.tileIdx, { data: ctx.data }).ok) completeGroundWork(state, job, ctx);
  idleWorker(state, workerRow, ctx.tick);
  return true;
}

/**
 * Walks the worker towards its job: `arrived` (in reach: work now), `moving`, or `abandoned` (no path: the job is
 * dropped from `jobs` and its chain goes on).
 */
function approachJob(
  state: PlanetState,
  job: WorkJobRecord,
  wRow: number,
  jobs: Record<string, WorkJobRecord>,
  ctx: StepContext,
): 'arrived' | 'moving' | 'abandoned' {
  const e = state.entities, cols = e.cols;
  if (isWorkerAtJob(state, wRow, job.q, job.r)) return 'arrived';
  const goal = { q: job.q, r: job.r, minDist: 1, maxDist: workReach(cols.kind[wRow]) };
  const report = !job.chain || (job.chainSeq ?? 0) === 0; // a chain's automatic follow-up is skipped silently
  if (abandonUnreachableJob(state, job.workerEntityId, wRow, goal, ctx, report)) {
    delete jobs[job.jobId];
    continueWorkChain(state, job, jobs, ctx, true);
    return 'abandoned';
  }
  setField(e, wRow, 'targetQ', job.q, ctx.tick);
  setField(e, wRow, 'targetR', job.r, ctx.tick);
  if (cols.state[wRow] !== ENTITY_STATE.moving) setField(e, wRow, 'state', ENTITY_STATE.moving, ctx.tick);
  requestMove(state, wRow, goal, ctx);
  syncWorkerView(state, wRow, ctx.tick, ctx.data);
  return 'moving';
}

/**
 * Whether the colony grid shed `job` last power step (brownout, shed group 1, `UO-TF-02`): it then waits for power
 * (`waiting`, `power`) and keeps its progress; a job that was waiting for power goes on. Returns whether it waits and
 * whether the record changed.
 */
function waitForPower(state: PlanetState, job: WorkJobRecord): { waits: boolean; changed: boolean } {
  const power = state.colonies[job.colonyId]?.power as { shedWorkJobIds?: readonly string[] } | undefined;
  if (power?.shedWorkJobIds?.includes(job.jobId)) {
    const changed = job.status !== 'waiting' || job.waitReason !== 'power';
    job.status = 'waiting';
    job.waitReason = 'power';
    return { waits: true, changed };
  }
  if (job.waitReason !== 'power') return { waits: false, changed: false };
  job.status = 'in_progress';
  job.waitReason = undefined;
  return { waits: false, changed: true };
}

export const workJobsSystem = defineSystem({
  id: 'terraform.workJobs',
  slot: 6,
  wave: 'W01',
  run(state, ctx) {
    const jobs = getWorkJobsMap(state);
    const entries = Object.values(jobs);
    if (entries.length === 0) return;

    const e = state.entities, cols = e.cols;
    const processedWorkers = new Set<number>();
    let changed = false;

    for (const job of entries) {
      if (processedWorkers.has(job.workerEntityId)) continue;
      const wRow = rowOf(e, job.workerEntityId);
      if (wRow < 0 || cols.hp[wRow] <= 0) { delete jobs[job.jobId]; changed = true; continue; }
      processedWorkers.add(job.workerEntityId);

      if (job.mode === 'repair' && job.targetEntityId !== undefined) {
        const tRow = rowOf(e, job.targetEntityId);
        if (tRow >= 0) { job.q = cols.q[tRow]; job.r = cols.r[tRow]; }
      }
      const approach = approachJob(state, job, wRow, jobs, ctx);
      if (approach === 'abandoned') changed = true;
      if (approach !== 'arrived') continue;

      cancelMove(state, job.workerEntityId, ctx.tick);
      if (hexDistance(cols.q[wRow], cols.r[wRow], job.q, job.r) > 0) faceTowards(state, wRow, job.q, job.r, ctx.tick);
      if (cols.state[wRow] !== ENTITY_STATE.working) setField(e, wRow, 'state', ENTITY_STATE.working, ctx.tick);
      const power = waitForPower(state, job);
      if (power.changed) changed = true;
      if (power.waits) { syncWorkerView(state, wRow, ctx.tick, ctx.data); continue; }

      const done = job.mode === 'repair' ? stepRepairWorkJob(state, job, wRow, ctx) : stepGroundWorkJob(state, job, wRow, ctx);
      changed = true;
      if (done) {
        delete jobs[job.jobId];
        continueWorkChain(state, job, jobs, ctx);
      }
      syncWorkerView(state, wRow, ctx.tick, ctx.data);
    }

    if (changed) saveWorkJobsMap(state, jobs, ctx.tick);
  },
});
