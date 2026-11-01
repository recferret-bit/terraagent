import { describe, expect, it } from 'vitest';
import { waitForPrograms } from './warmup';

describe('waitForPrograms (shader warm-up)', () => {
  it('resolves once every program is ready, and treats a material without a program (disposed mid-compile) as done', async () => {
    let readyAfter = 3;
    const a = {}, b = {}, c = {};
    const props = new Map<object, { currentProgram?: { isReady(): boolean } }>([
      [a, { currentProgram: { isReady: () => --readyAfter <= 0 } }],
      [b, {}], // disposed / swapped while compiling: used to throw "reading 'isReady'"
      [c, { currentProgram: { isReady: () => true } }],
    ]);
    const r = { properties: { get: (m: object) => props.get(m) ?? {} } };
    await expect(waitForPrograms(r, new Set([a, b, c]), () => false, 1)).resolves.toBeUndefined();
    expect(readyAfter).toBeLessThanOrEqual(0);
  });

  it('stops waiting when the session goes stale', async () => {
    const m = {};
    const r = { properties: { get: () => ({ currentProgram: { isReady: () => false } }) } };
    let stale = false;
    const p = waitForPrograms(r, new Set([m]), () => stale, 1);
    stale = true;
    await expect(p).resolves.toBeUndefined();
  });
});
