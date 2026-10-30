import { describe, expect, it } from 'vitest';
import { step } from '../src';
import { cmd, fresh, pipeline } from './kernel/fixtures';

/** SIM-D-01/04/05: same seed + same commands at the same steps → the same state. */
function run(seed: string) {
  const s = fresh(seed);
  const events = [];
  for (let t = 0; t < 200; t++) {
    const cmds = t % 20 === 0 ? [cmd('test.spawn', { q: t % 5, r: -(t % 3) })] : [];
    const res = step(s, cmds, t % 50 === 49 ? 5 : 1, pipeline);
    events.push(...res.events);
  }
  return { s, events };
}

describe('reproducible', () => {
  it('same seed + commands give a deep-equal state twice', () => {
    const a = run('alpha'), b = run('alpha');
    expect(a.s.entities.count).toBe(10);
    expect(a.s).toEqual(b.s);
    expect(a.events).toEqual(b.events);
  });

  it('a different seed diverges', () => {
    expect(run('alpha').s.entities.cols.x).not.toEqual(run('beta').s.entities.cols.x);
  });

  it('ticks advance by dt', () => {
    const s = fresh();
    step(s, [], 1, pipeline);
    step(s, [], 5, pipeline);
    expect(s.meta.tick).toBe(6);
  });
});
