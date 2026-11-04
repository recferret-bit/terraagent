export type PlanPriority = 'routine' | 'critical';

export interface PlanJob {
  readonly id: string;
  readonly colonyId: string;
  readonly trigger: string;
  readonly priority: PlanPriority;
  readonly deadlineAtMs: number;
  readonly enqueuedAtMs: number;
}

export type EnqueueResult = 'queued' | 'coalesced' | 'expired';

/**
 * Admission policy in front of pg-boss (AI §7). Same colony and trigger coalesce.
 * Critical jobs run before routine ones. A deadline that has passed is not claimed.
 */
export class PlanSchedule {
  private readonly jobs: PlanJob[] = [];

  enqueue(job: PlanJob, nowMs: number): EnqueueResult {
    if (job.deadlineAtMs <= nowMs) return 'expired';
    const twin = this.jobs.find((row) => row.colonyId === job.colonyId && row.trigger === job.trigger);
    if (twin) return 'coalesced';
    this.jobs.push(job);
    return 'queued';
  }

  /** Next live job. Critical beats routine. Expired rows are dropped. */
  claim(nowMs: number): PlanJob | null {
    const live = this.jobs.filter((job) => job.deadlineAtMs > nowMs);
    this.jobs.length = 0;
    this.jobs.push(...live);
    const critical = live.find((job) => job.priority === 'critical');
    const next = critical ?? live.find((job) => job.priority === 'routine') ?? null;
    if (!next) return null;
    const index = this.jobs.indexOf(next);
    this.jobs.splice(index, 1);
    return next;
  }
}
