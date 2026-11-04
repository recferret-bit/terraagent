export type ClaimResult = 'claimed' | 'busy' | 'stale' | 'done';

interface Held {
  workerId: string;
  fence: number;
  done: boolean;
}

/** One claim per job. A lower fence cannot finish or reclaim it (AI §7). */
export class JobClaims {
  private readonly held = new Map<string, Held>();

  claim(jobId: string, workerId: string, fence: number): ClaimResult {
    const row = this.held.get(jobId);
    if (row?.done) return 'stale';
    if (row && row.fence > fence) return 'stale';
    if (row && row.workerId !== workerId) return 'busy';
    this.held.set(jobId, { workerId, fence: row ? Math.max(row.fence, fence) : fence, done: false });
    return 'claimed';
  }

  finish(jobId: string, workerId: string, fence: number): ClaimResult {
    const row = this.held.get(jobId);
    if (!row || row.workerId !== workerId || row.fence !== fence || row.done) return 'stale';
    row.done = true;
    return 'done';
  }
}
