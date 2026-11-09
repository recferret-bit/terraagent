import { expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import { compileData, decodeSnapshot, emitFaunaDirective, encodeSnapshot, setBlob, setOverride, SimHost, SIM_VERSION } from '@terra/sim';
import { faunaPoses as poses, faunaWireFixture } from './fauna-motion-fixture';

it('discards stale reconstruction after a missing delta and resumes from a fresh welcome', async () => {
  const fixture = faunaWireFixture('server', 19);
  try {
    fixture.host.step(2);
    expect(fixture.worker.core.delta({ fromTick: 20, toTick: 21, diff: fixture.host.diffSince(20, { forClient: true }) }))
      .toMatchObject({ ok: false, reason: 'gap', request: true });
    fixture.welcome();
    for (let i = 0; i < 8; i++) {
      fixture.step();
      expect(fixture.worker.core.status).toBe('ready');
      expect(poses(fixture.worker.core.view())).toEqual(poses(fixture.host.view()));
    }
  } finally { await fixture.close(); }
});

it('uses current balance data when fauna speed is tuned during a patrol', async () => {
  const fixture = faunaWireFixture('server', 19);
  try {
    const flags = parseWaves('..07');
    const path = 'fauna.blackAnt.speed';
    const data = compileData(flags, setOverride({}, path, 0.5));
    const tuned = new SimHost({ flags, data });
    tuned.load(fixture.host.state);
    expect(fixture.worker.core.retune({ op: 'set', path, value: 0.5, dataHash: data.hash })).toBe(true);
    for (let i = 0; i < 8; i++) {
      const fromTick = tuned.tick;
      tuned.step(1);
      fixture.worker.handle({ t: 'delta', fromTick, toTick: tuned.tick, diff: tuned.diffSince(fromTick, { forClient: true }) });
      expect(poses(fixture.worker.core.view())).toEqual(poses(tuned.view()));
    }
  } finally { await fixture.close(); }
});

it('accepts a legacy welcome without a motion seed and converges on the next authoritative correction', async () => {
  const fixture = faunaWireFixture('server', 19);
  try {
    const oldSnapshot = decodeSnapshot(fixture.host.snapshot({ forClient: true }));
    delete oldSnapshot.blobs.faunaMotionSeed;
    expect(fixture.worker.core.welcome({ state: encodeSnapshot(oldSnapshot), tick: 19,
      flags: parseWaves('..07').list, dataHash: fixture.host.pipeline.config.data.hash, simVersion: SIM_VERSION })).toEqual({ ok: true });
    while (fixture.host.tick < 25) fixture.step();
    expect(fixture.worker.core.status).toBe('ready');
    expect(poses(fixture.worker.core.view())).toEqual(poses(fixture.host.view()));
  } finally { await fixture.close(); }
});

it.each([18, 19])('requests a fresh welcome for a newly received directive at already reconstructed tick %i', async effectiveTick => {
  const fixture = faunaWireFixture('server', 19);
  try {
    fixture.host.step(1);
    emitFaunaDirective(fixture.host.state, { effectiveTick, hiveId: 1, decisionIndex: 1,
      kind: 'mode', payload: { mode: 'passive' } });
    setBlob(fixture.host.state, 'faunaDirectives', fixture.host.state.blobs.faunaDirectives.value, 20);
    expect(fixture.worker.core.delta({ fromTick: 19, toTick: 20, diff: fixture.host.diffSince(19, { forClient: true }) }))
      .toMatchObject({ ok: false, reason: 'badDiff', request: true });
    fixture.welcome();
    fixture.step();
    expect(fixture.worker.core.status).toBe('ready');
    expect(poses(fixture.worker.core.view())).toEqual(poses(fixture.host.view()));
  } finally { await fixture.close(); }
});
