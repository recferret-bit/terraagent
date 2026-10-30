import { flagsFromList } from '@terra/contracts';
import { compileData, createPlanet, SIM_VERSION, SimHost } from '@terra/sim';
import { describe, expect, it } from 'vitest';
import { ReplicaCore } from '../replica/ReplicaCore';
import { Predictor } from './Predictor';
import { StepTimes } from './stepTimes';

describe('StepTimes', () => {
  it('computes p95 over a sliding window and needs enough samples', () => {
    const s = new StepTimes(20, 10);
    for (let i = 0; i < 9; i++) s.add(10);
    expect(s.exceeds()).toBe(false); // too few samples
    s.add(10);
    expect(s.exceeds()).toBe(true);
    for (let i = 0; i < 20; i++) s.add(1);
    expect(s.p95()).toBe(1);
    expect(s.exceeds()).toBe(false);
    s.add(50);
    expect(s.exceeds()).toBe(false); // one outlier in 20 is under p95
  });
});

describe('Predictor auto-off', () => {
  it('turns prediction off when the rebuild p95 exceeds the limit', () => {
    const auth = new SimHost({ flags: ['W00'] });
    auth.load(createPlanet({ type: 'flat', seed: 'p95' }));
    let t = 1000;
    // every clock read costs 6 ms, so each rebuild measures 6 ms
    const p = new Predictor(new ReplicaCore(), { now: () => (t += 6) });
    p.welcome({ state: auth.snapshot(), tick: 0, flags: ['W00'], dataHash: compileData(flagsFromList(['W00'])).hash, simVersion: SIM_VERSION, serverTimeMs: 0 });
    for (let i = 0; i < 40 && p.enabled; i++) { p.submit({ id: `cm_${i}`, kind: 'dev.ping', args: {} }); p.host(); }
    expect(p.enabled).toBe(false);
    expect(p.autoOff!.p95Ms).toBeGreaterThan(4);
    expect(p.host()).toBe(p.confirmed.simHost);
  });

  it('stays on while rebuilds are cheap', () => {
    const auth = new SimHost({ flags: ['W00'] });
    auth.load(createPlanet({ type: 'flat', seed: 'p95' }));
    const p = new Predictor(new ReplicaCore(), { now: () => 1000 });
    p.welcome({ state: auth.snapshot(), tick: 0, flags: ['W00'], dataHash: compileData(flagsFromList(['W00'])).hash, simVersion: SIM_VERSION, serverTimeMs: 0 });
    for (let i = 0; i < 40; i++) { p.submit({ id: `cm_${i}`, kind: 'dev.ping', args: {} }); p.host(); }
    expect(p.enabled).toBe(true);
    expect(p.autoOff).toBeNull();
  });
});
