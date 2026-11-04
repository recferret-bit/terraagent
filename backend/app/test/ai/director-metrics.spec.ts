import { describe, expect, it } from 'vitest';
import { DirectorMetrics, type DirectorObservation } from '../../src/ai/metrics/director.js';

function sample(over: Partial<DirectorObservation> = {}): DirectorObservation {
  return {
    trigger: 'resource.critical',
    skill: 'resources',
    risk: 'conservative',
    outcome: 'proposed',
    waitMs: 10,
    actionState: 'applied',
    ...over,
  };
}

describe('W16-23 director metrics', () => {
  it('counts three observations and reports the oldest wait', () => {
    const metrics = new DirectorMetrics();
    metrics.observe(sample({ waitMs: 12 }));
    metrics.observe(sample({ waitMs: 80, outcome: 'applied' }));
    metrics.observe(sample({
      trigger: 'under_attack',
      skill: 'defence',
      risk: 'risky',
      outcome: 'rejected',
      waitMs: 30,
      actionState: 'rejected',
    }));
    expect(metrics.actionCounts()).toEqual({ proposed: 0, applied: 2, rejected: 1, superseded: 0 });
    expect(metrics.oldestWaitMs()).toBe(80);
    expect(metrics.labels()).toEqual([
      { trigger: 'resource.critical', skill: 'resources', risk: 'conservative' },
      { trigger: 'under_attack', skill: 'defence', risk: 'risky' },
    ]);
  });

  it('rejects a colony id used as a skill and keeps it out of labels', () => {
    const metrics = new DirectorMetrics();
    metrics.observe(sample());
    expect(() => metrics.observe(sample({ skill: 'co_secret', waitMs: 9_000, actionState: 'rejected' }))).toThrow(/bounded/);
    expect(() => metrics.observe(sample({ trigger: 'x'.repeat(41) }))).toThrow(/bounded/);
    expect(JSON.stringify(metrics.labels())).not.toContain('co_');
    expect(metrics.labels()).toEqual([{ trigger: 'resource.critical', skill: 'resources', risk: 'conservative' }]);
    expect(metrics.oldestWaitMs()).toBe(10);
    expect(metrics.actionCounts().applied).toBe(1);
    expect(metrics.actionCounts().rejected).toBe(0);
  });
});
