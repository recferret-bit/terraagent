import { compileData, dataRow, type CompiledRow } from '../../data';
import type { CompiledDataLike } from '../../kernel/config';
import { rowNum } from '../rows';

/**
 * Crews (owner feedback W03 #9): several workers on one job (a construction site, a repair, a dismantle) finish it
 * sooner, with diminishing returns. The k-th worker that works a job in a step (k = 0 for the first) adds
 * `helperEfficiency^k` of its own work rate; workers past `maxCrew` add nothing (`data/work-crew.ts`). Every job pays
 * (or refunds) by its progress, never per worker, so a crew costs exactly what one worker costs.
 */

/** The per-step crew tally a job carries: the step it was last worked and how many workers worked it in that step. */
export interface CrewTally {
  crewTick?: number;
  crewCount?: number;
}

let cachedDefault: CompiledDataLike | null = null;

/** Row `workCrew.<id>` of `data`, else of the W00–W03 defaults (a caller without data, a wave without the table). */
export function workCrewRow(data: CompiledDataLike | undefined, id: 'crew' | 'repair' | 'dismantle'): CompiledRow {
  if ((data?.tables.workCrew as Record<string, unknown> | undefined)?.[id]) return dataRow(data!, 'workCrew', id);
  cachedDefault ??= compileData(new Set(['W00', 'W01', 'W02', 'W03']));
  return dataRow(cachedDefault, 'workCrew', id);
}

/** The crew settings: helper efficiency, crew cap, auto-help radius (hexes). */
export function crewConfig(data?: CompiledDataLike): { helperEfficiency: number; maxCrew: number; autoHelpRadius: number } {
  const row = workCrewRow(data, 'crew');
  return { helperEfficiency: rowNum(row, 'helperEfficiency'), maxCrew: rowNum(row, 'maxCrew'), autoHelpRadius: rowNum(row, 'autoHelpRadius') };
}

/** The share of its work rate the k-th worker (0-based) on a job adds in one step. */
export function crewShareAt(k: number, data?: CompiledDataLike): number {
  const { helperEfficiency, maxCrew } = crewConfig(data);
  if (k >= maxCrew) return 0;
  let share = 1;
  for (let i = 0; i < k; i++) share *= helperEfficiency;
  return share;
}

/**
 * The next worker on `job` this step: its share of its own work rate, and the job's tally after it (the caller stores
 * the tally with the job). Pure: the job is not changed.
 */
export function nextCrewShare(job: CrewTally, tick: number, data?: CompiledDataLike): { share: number; tally: Required<CrewTally> } {
  const k = job.crewTick === tick ? (job.crewCount ?? 0) : 0;
  return { share: crewShareAt(k, data), tally: { crewTick: tick, crewCount: k + 1 } };
}

/** The combined work rate (in units of one worker's rate) of a crew of `n` equal workers. */
export function crewRate(n: number, data?: CompiledDataLike): number {
  let sum = 0;
  for (let k = 0; k < n; k++) sum += crewShareAt(k, data);
  return sum;
}
