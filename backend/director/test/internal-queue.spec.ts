import { describe, expect, it } from 'vitest';
import { InternalDirectorQueue } from '../src/internal-queue.js';

describe('InternalDirectorQueue (Zero-Port Internal Queue Bridge)', () => {
  it('enqueues, claims with monotonic fences, and completes jobs', () => {
    const queue = new InternalDirectorQueue();
    const now = 1000;

    const res = queue.enqueue('job-1', 'col-1', 'resource.shortage', 'routine', 'colony_plan', { brief: 1 }, 20000, now);
    expect(res).toBe('queued');
    expect(queue.pendingCount()).toBe(1);

    const claimed = queue.claim('worker-A', now + 100);
    expect(claimed).not.toBeNull();
    expect(claimed?.job.id).toBe('job-1');
    expect(claimed?.fence).toBe(1);

    const completed = queue.complete('job-1', 'worker-A', claimed!.fence, { directive: 'ok' });
    expect(completed).toBe(true);
    expect(queue.pendingCount()).toBe(0);

    const result = queue.getResult('job-1');
    expect(result?.ok).toBe(true);
    expect(result?.result).toEqual({ directive: 'ok' });
  });

  it('prioritizes critical jobs over routine jobs', () => {
    const queue = new InternalDirectorQueue();
    const now = 2000;

    queue.enqueue('routine-1', 'col-1', 'trade.tick', 'routine', 'colony_plan', {}, 20000, now);
    queue.enqueue('critical-1', 'col-2', 'under_attack', 'critical', 'colony_plan', {}, 20000, now);

    const firstClaim = queue.claim('worker-A', now + 50);
    expect(firstClaim?.job.id).toBe('critical-1');

    const secondClaim = queue.claim('worker-A', now + 100);
    expect(secondClaim?.job.id).toBe('routine-1');
  });

  it('drops expired jobs and coalesces identical trigger jobs', () => {
    const queue = new InternalDirectorQueue();
    const now = 5000;

    const expired = queue.enqueue('expired-1', 'col-1', 'storm', 'routine', 'colony_plan', {}, -100, now);
    expect(expired).toBe('expired');

    const first = queue.enqueue('twin-1', 'col-1', 'shortage', 'routine', 'colony_plan', {}, 20000, now);
    expect(first).toBe('queued');

    const twin = queue.enqueue('twin-2', 'col-1', 'shortage', 'routine', 'colony_plan', {}, 20000, now);
    expect(twin).toBe('coalesced');
  });

  it('rejects stale fence completions', () => {
    const queue = new InternalDirectorQueue();
    const now = 1000;

    queue.enqueue('job-stale', 'col-1', 'tick', 'routine', 'colony_plan', {}, 20000, now);
    const claimed = queue.claim('worker-1', now + 10);

    // Wrong fence
    const failedFinish = queue.complete('job-stale', 'worker-1', claimed!.fence + 99, { data: 1 });
    expect(failedFinish).toBe(false);
  });

  it('prunes payloads that expire at the exact deadline boundary before claim', () => {
    const queue = new InternalDirectorQueue();
    const now = 1000;
    expect(queue.enqueue('job-ttl', 'col-1', 'tick', 'routine', 'colony_plan', {}, 500, now)).toBe('queued');
    expect(queue.pendingCount()).toBe(1);

    // Exact boundary now + 500 -> expired
    expect(queue.claim('worker-1', now + 500)).toBeNull();
    expect(queue.pendingCount()).toBe(0);
    expect(queue.getResult('unknown')).toBeNull();
  });
});
