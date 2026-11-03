import type { WorkJobRecord } from '@terra/sim';
import type { GameView } from '../../core/registry/types';

/** The fields of a `blobs.workJobs` record the status line reads. */
export type WorkJobView = Pick<
  WorkJobRecord,
  'jobId' | 'colonyId' | 'workerEntityId' | 'mode' | 'terrainKey' | 'q' | 'r' | 'progress' | 'status' | 'waitReason' | 'chain' | 'chainSeq'
>;

/** `colonyId`'s open `work` jobs (TERRAFORM chains and repairs) in the view (`blobs.workJobs.byId`). */
export function colonyWorkJobs(view: GameView | null | undefined, colonyId: number): WorkJobView[] {
  const byId = (view?.blobs?.workJobs as { byId?: Record<string, WorkJobView> } | undefined)?.byId;
  if (!byId) return [];
  return Object.values(byId)
    .filter((j) => j && j.colonyId === colonyId)
    .sort((a, b) => (a.jobId < b.jobId ? -1 : a.jobId > b.jobId ? 1 : 0));
}

const GROUND_NAME: Readonly<Record<string, string>> = {
  forest: 'TREES',
  rock: 'ROCK',
  slope: 'SLOPE',
  hole: 'CRATER',
  flat: 'GROUND',
};

function jobText(j: WorkJobView): string {
  const pct = `${Math.round(Math.max(0, Math.min(1, Number(j.progress) || 0)) * 100)}%`;
  const at = `(${j.q},${j.r})`;
  const wait = j.status === 'waiting' ? ` · waiting${j.waitReason ? ` (${j.waitReason})` : ''}` : '';
  if (j.mode === 'repair') return `REPAIR ${at} ${pct}${wait}`;
  if (j.mode === 'dismantle') return `DISMANTLE ${at} ${pct}${wait}`;
  const hex = j.chain ? ` · hex ${(j.chainSeq ?? 0) + 1}` : '';
  return `TERRAFORM ${GROUND_NAME[j.terrainKey ?? ''] ?? 'HEX'} ${at} ${pct}${hex}${wait}`;
}

/** One status line for the colony's running work: the first job, plus how many more workers are busy. */
export function workStatusText(jobs: readonly WorkJobView[]): string | null {
  if (jobs.length === 0) return null;
  const more = jobs.length > 1 ? ` · +${jobs.length - 1} more` : '';
  return `${jobText(jobs[0]!)}${more}`;
}
