import { JobClaims } from './claim.js';
import { PlanSchedule, type PlanJob, type PlanPriority } from './schedule.js';

export interface InternalQueueJob extends PlanJob {
  readonly payload: unknown;
  readonly type: 'colony_plan' | 'sector_advisor';
}

export interface JobExecutionResult {
  readonly jobId: string;
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error?: string;
  readonly completedAtMs: number;
}

/**
 * Pure internal memory queue bridge connecting the game authority to the AI Director.
 * Zero open ports, zero public endpoints, zero external socket listeners (AI §1, §7).
 */
export class InternalDirectorQueue {
  private readonly schedule = new PlanSchedule();
  private readonly claims = new JobClaims();
  private readonly payloads = new Map<string, InternalQueueJob>();
  private readonly results = new Map<string, JobExecutionResult>();
  private fenceCounter = 1;

  enqueue(
    jobId: string,
    colonyId: string,
    trigger: string,
    priority: PlanPriority,
    type: 'colony_plan' | 'sector_advisor',
    payload: unknown,
    ttlMs = 20_000,
    nowMs = Date.now(),
  ): 'queued' | 'coalesced' | 'expired' {
    const job: InternalQueueJob = {
      id: jobId,
      colonyId,
      trigger,
      priority,
      type,
      payload,
      enqueuedAtMs: nowMs,
      deadlineAtMs: nowMs + ttlMs,
    };
    const res = this.schedule.enqueue(job, nowMs);
    if (res === 'queued') {
      this.payloads.set(jobId, job);
    }
    return res;
  }

  claim(workerId: string, nowMs = Date.now()): { job: InternalQueueJob; fence: number } | null {
    for (const [id, p] of this.payloads) {
      if (p.deadlineAtMs <= nowMs) this.payloads.delete(id);
    }
    const next = this.schedule.claim(nowMs);
    if (!next) return null;
    const fullJob = this.payloads.get(next.id);
    if (!fullJob) return null;

    const fence = this.fenceCounter++;
    const claimRes = this.claims.claim(next.id, workerId, fence);
    if (claimRes !== 'claimed') return null;

    return { job: fullJob, fence };
  }

  complete(jobId: string, workerId: string, fence: number, result: unknown, error?: string): boolean {
    const finishRes = this.claims.finish(jobId, workerId, fence);
    if (finishRes !== 'done') return false;

    this.results.set(jobId, {
      jobId,
      ok: !error,
      result,
      error,
      completedAtMs: Date.now(),
    });
    this.payloads.delete(jobId);
    return true;
  }

  getResult(jobId: string): JobExecutionResult | null {
    return this.results.get(jobId) ?? null;
  }

  pendingCount(): number {
    return this.payloads.size;
  }
}
