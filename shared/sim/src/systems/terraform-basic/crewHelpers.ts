import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { rowOf, setField } from '../../ecs/store';
import { hexDistance } from '../../grid/hex';
import type { CompiledDataLike } from '../../kernel/config';
import type { StepContext } from '../../kernel/context';
import type { PlanetState, SimState } from '../../kernel/state';
import { UnitBook } from '../../units/book';
import { cancelMove } from '../../units/movement/orchestrator';
import { crewConfig } from '../dispatch/crew';
import { getWorkJobsMap, isLeadJob, saveWorkJobsMap, type WorkJobRecord } from './workJobs';
import { primeWorkerForWorkJob, syncWorkerView } from './workTile';

/**
 * Helpers on a repair or dismantle job (owner feedback W03 #9). A helper is a work-job record with `helpOf` = the lead
 * job's id: the work-jobs system walks its worker to the job like any other and, once there, the worker adds its crew
 * share to the lead's progress (`../dispatch/crew.ts`). The lead pays (repair) or refunds (dismantle) by progress, so
 * helpers make the job faster, never cheaper or dearer. Helpers join two ways: a player order naming a worker on a
 * job that is already open, and idle Builder Drones near an open job (`attachIdleHelpers`).
 */

const CREW_MODES: ReadonlySet<WorkJobRecord['mode']> = new Set(['repair', 'dismantle']);

/** The helper record id of worker `workerId` on lead `leadId`. */
const helperJobId = (leadId: string, workerId: number): string => `${leadId}+${workerId}`;

/** Workers on `lead` now: its own worker plus its helpers. */
function crewSize(jobs: Readonly<Record<string, WorkJobRecord>>, lead: WorkJobRecord): number {
  let n = 1;
  for (const id in jobs) if (jobs[id]!.helpOf === lead.jobId) n++;
  return n;
}

function helperRecord(lead: WorkJobRecord, workerId: number): WorkJobRecord {
  return {
    jobId: helperJobId(lead.jobId, workerId), colonyId: lead.colonyId, mode: lead.mode, workerEntityId: workerId,
    targetEntityId: lead.targetEntityId, q: lead.q, r: lead.r, tileIdx: lead.tileIdx, durationTicks: lead.durationTicks,
    elapsedTicks: 0, progress: 0, startHp: 0, hpMax: 0, energyCost: 0, yields: {}, totalCost: {}, spentCost: {},
    status: 'in_progress', helpOf: lead.jobId,
  };
}

/**
 * Puts worker `workerId` on `lead` as a helper (a player order naming a worker on a job already open). No-op when it
 * already works the job or the crew is full. Returns whether a helper joined.
 */
export function joinJobAsHelper(state: SimState, lead: WorkJobRecord, workerId: number, tick: number, data?: CompiledDataLike): boolean {
  const jobs = getWorkJobsMap(state);
  if (lead.workerEntityId === workerId || jobs[helperJobId(lead.jobId, workerId)]) return false;
  if (crewSize(jobs, lead) >= crewConfig(data).maxCrew) return false;
  const busy = Object.values(jobs).some((j) => j.workerEntityId === workerId);
  const helper = helperRecord(lead, workerId);
  jobs[helper.jobId] = helper;
  saveWorkJobsMap(state, jobs, tick);
  if (!busy) primeWorkerForWorkJob(state as PlanetState, workerId, lead.q, lead.r, tick, data);
  return true;
}

/** An idle Builder Drone of `colonyId` with nothing to do (no work job, no unit command), as a helper candidate. */
function isIdleBuilder(state: PlanetState, row: number, colonyId: number, busy: ReadonlySet<number>, book: UnitBook): boolean {
  const cols = state.entities.cols;
  if (cols.kind[row] !== ENTITY_KIND.builder || cols.owner[row] !== colonyId || cols.hp[row] <= 0) return false;
  if (cols.state[row] !== ENTITY_STATE.idle || busy.has(cols.id[row])) return false;
  const rec = book.peek(cols.id[row]);
  return !rec || (rec.current === null && rec.queue.length === 0);
}

/**
 * Idle Builder Drones join open repair and dismantle jobs within `workCrew.crew.autoHelpRadius` hexes, nearest first,
 * up to `maxCrew` workers per job (work-jobs system, after auto-repair queued its jobs). Returns whether `jobs` changed.
 */
export function attachIdleHelpers(state: PlanetState, jobs: Record<string, WorkJobRecord>, ctx: StepContext): boolean {
  const leads = Object.values(jobs).filter((j) => isLeadJob(j) && CREW_MODES.has(j.mode));
  if (leads.length === 0) return false;
  const { maxCrew, autoHelpRadius } = crewConfig(ctx.data);
  const e = state.entities, cols = e.cols;
  const busy = new Set(Object.values(jobs).map((j) => j.workerEntityId));
  let book: UnitBook | null = null;
  let changed = false;
  for (const lead of leads) {
    let free = maxCrew - crewSize(jobs, lead);
    while (free > 0) {
      let best = -1, bestD = Infinity;
      for (let row = 0; row < e.count; row++) {
        if (cols.kind[row] !== ENTITY_KIND.builder) continue;
        book ??= new UnitBook(state);
        if (!isIdleBuilder(state, row, lead.colonyId, busy, book)) continue;
        const d = hexDistance(cols.q[row], cols.r[row], lead.q, lead.r);
        if (d <= autoHelpRadius && d < bestD) { best = row; bestD = d; }
      }
      if (best < 0) break;
      const helper = helperRecord(lead, cols.id[best]);
      jobs[helper.jobId] = helper;
      busy.add(cols.id[best]);
      primeWorkerForWorkJob(state, cols.id[best], lead.q, lead.r, ctx.tick, ctx.data);
      changed = true;
      free--;
    }
  }
  return changed;
}

/** Ends the helpers of `leadId` (its job ended): each helper's worker stops and idles. */
export function releaseHelpers(state: PlanetState, jobs: Record<string, WorkJobRecord>, leadId: string, tick: number, data?: CompiledDataLike): void {
  for (const [id, job] of Object.entries(jobs)) {
    if (job.helpOf !== leadId) continue;
    delete jobs[id];
    const wRow = rowOf(state.entities, job.workerEntityId);
    if (wRow < 0) continue;
    cancelMove(state, job.workerEntityId, tick);
    setField(state.entities, wRow, 'progress', 0, tick);
    setField(state.entities, wRow, 'state', ENTITY_STATE.idle, tick);
    syncWorkerView(state, wRow, tick, data);
  }
}
