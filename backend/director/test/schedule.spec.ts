import { describe, expect, it } from 'vitest';
import { PlanSchedule, type PlanJob } from '../src/schedule.js';

function job(over: Partial<PlanJob> & Pick<PlanJob, 'id' | 'priority'>): PlanJob {
  return {
    colonyId: 'co_1',
    trigger: 'resource.shortage',
    deadlineAtMs: 10_000,
    enqueuedAtMs: 0,
    ...over,
  };
}

describe('W16-30 plan schedule', () => {
  it('coalesces a duplicate trigger and claims a critical job before a routine one', () => {
    const schedule = new PlanSchedule();
    expect(schedule.enqueue(job({ id: 'routine', priority: 'routine', enqueuedAtMs: 0 }), 0)).toBe('queued');
    expect(schedule.enqueue(job({ id: 'dup', priority: 'routine', enqueuedAtMs: 1 }), 1)).toBe('coalesced');
    expect(schedule.enqueue(job({ id: 'hot', priority: 'critical', trigger: 'under_attack', enqueuedAtMs: 2 }), 2)).toBe('queued');
    expect(schedule.claim(3)?.id).toBe('hot');
    expect(schedule.claim(3)?.id).toBe('routine');
  });

  it('does not queue or claim work past its deadline', () => {
    const schedule = new PlanSchedule();
    expect(schedule.enqueue(job({ id: 'late', priority: 'critical', deadlineAtMs: 5 }), 5)).toBe('expired');
    schedule.enqueue(job({ id: 'soon', priority: 'routine', deadlineAtMs: 8 }), 0);
    expect(schedule.claim(8)).toBeNull();
  });
});
