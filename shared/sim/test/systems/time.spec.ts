import { describe, expect, it } from 'vitest';
import {
  compileData,
  computeDeterministicDaylight,
  computePlanetTimeAtTick,
  createPlanet,
  getPlanetTime,
  previewPlanetTimePatch,
  setPlanetTime,
  SimHost,
  TICKS_PER_SECOND,
  wrapPlanetHour,
  type SimCommand,
} from '../../src';

function createHost(): SimHost {
  const host = new SimHost({ flags: ['W00', 'W01'] });
  host.load(createPlanet({ type: 'temperate', seed: 'time-test', radius: 6 }));
  return host;
}

describe('planet time & day/night cycle system (time.cycle)', () => {
  it('advances solar time deterministically based on realHoursPerDay and timeScale', () => {
    const host = createHost();
    const initial = getPlanetTime(host.state);
    expect(initial.timeOfDay).toBeCloseTo(9.0, 5);
    expect(initial.realHoursPerDay).toBeCloseTo(0.25, 5);
    expect(initial.timeScale).toBeCloseTo(1.0, 5);
    expect(initial.phase).toBe('day');

    // Idle planet does not allocate planetTime blob until configured or tuned (zero-diff idle ticks)
    host.step(10);
    expect(host.state.blobs.planetTime).toBeUndefined();

    // 0.25 real hours per day = 900 real seconds = 4500 ticks for 24 solar hours -> 1125 ticks for 6 solar hours
    host.step(1125 - 10);
    const afternoon = getPlanetTime(host.state);
    expect(afternoon.timeOfDay).toBeCloseTo(15.0, 3);
    expect(afternoon.phase).toBe('day');
    expect(afternoon.daylight).toBeGreaterThan(0.84);
  });

  it('re-anchors smoothly without solar clock jump when realHoursPerDay or timeScale changes', () => {
    const host = createHost();
    host.step(500);
    const before = getPlanetTime(host.state);

    // Change realHoursPerDay to 1.0 hour and timeScale to 4x via setPlanetTime
    const updated = setPlanetTime(host.state, { realHoursPerDay: 1.0, timeScale: 4.0 }, host.tick);
    expect(updated.timeOfDay).toBeCloseTo(before.timeOfDay, 5);
    expect(updated.realHoursPerDay).toBe(1.0);
    expect(updated.timeScale).toBe(4.0);

    // At 1.0 real hour/day (3600s) and 4x timeScale, 1 full 24h day takes 900s = 4500 ticks.
    // Stepping 2250 ticks advances exactly 12 solar hours.
    host.step(2250);
    const afterHalfDay = getPlanetTime(host.state);
    expect(afterHalfDay.timeOfDay).toBeCloseTo(wrapPlanetHour(before.timeOfDay + 12), 3);
  });
});

describe('planet time commands, replication, and balance overrides', () => {
  it('handles setPlanetTime and dev.time commands and replicates across authority and multiple client replicas', () => {
    const authority = createHost();
    authority.state.colonies[0] = {
      index: 0, id: 'col_0', name: 'Alpha', color: 0xff8800, status: 'active', changedAt: 0, stock: {},
    };
    const replicaA = new SimHost({ flags: ['W00', 'W01'] });
    const replicaB = new SimHost({ flags: ['W00', 'W01'] });
    replicaA.load(authority.snapshot());
    replicaB.load(authority.snapshot());

    let knownTick = authority.tick;
    const cmd: SimCommand = {
      colonyIndex: 0,
      source: 'player',
      commandId: 'cmd_time_1',
      kind: 'setPlanetTime',
      args: { timeOfDay: 18.25, realHoursPerDay: 0.5, timeScale: 2 },
    };
    authority.submit(cmd);
    authority.step(1);

    const diff1 = authority.diffSince(knownTick);
    replicaA.applyDiff(diff1);
    replicaB.applyDiff(diff1);
    knownTick = authority.tick;

    expect(getPlanetTime(replicaA.state)).toEqual(getPlanetTime(authority.state));
    expect(getPlanetTime(replicaB.state)).toEqual(getPlanetTime(authority.state));
    expect(getPlanetTime(replicaA.state).phase).toBe('dusk');

    // Step 60 ticks and verify both replicas compute identical fractional and discrete solar time
    authority.step(60);
    const diff2 = authority.diffSince(knownTick);
    replicaA.applyDiff(diff2);
    replicaB.applyDiff(diff2);
    knownTick = authority.tick;

    expect(getPlanetTime(replicaA.state).timeOfDay).toBeCloseTo(getPlanetTime(authority.state).timeOfDay, 6);
    expect(computePlanetTimeAtTick(replicaA.state, authority.tick + 0.5).timeOfDay)
      .toBeCloseTo(computePlanetTimeAtTick(replicaB.state, authority.tick + 0.5).timeOfDay, 6);

    // dev.time works without a colony index (e.g. W00 / pre-landing)
    authority.submit({
      colonyIndex: null,
      source: 'dev',
      commandId: 'cmd_dev_time',
      kind: 'dev.time',
      args: { timeOfDay: 0.5, timeScale: 0 },
    });
    authority.step(5);
    const diff3 = authority.diffSince(knownTick);
    replicaA.applyDiff(diff3);
    expect(getPlanetTime(replicaA.state).timeOfDay).toBeCloseTo(0.5, 5);
    expect(getPlanetTime(replicaA.state).phase).toBe('night');
  });

  it('re-anchors automatically when time.cycle.* is tuned via balance overrides', () => {
    const host = createHost();
    host.step(100);
    const beforeTune = getPlanetTime(host.state);

    const tunedData = compileData(new Set(['W00', 'W01']), { time: { cycle: { realHoursPerDay: 2 } } });
    const tunedHost = new SimHost({
      flags: ['W00', 'W01'],
      data: tunedData,
    });
    tunedHost.load(host.state);
    tunedHost.step(1);
    const afterTune = getPlanetTime(tunedHost.state, tunedData);
    expect(afterTune.realHoursPerDay).toBe(2);
    expect(getPlanetTime(tunedHost.state).realHoursPerDay).toBe(2);
    // Should not jump backwards to 9:00; should continue smoothly from beforeTune.timeOfDay
    const expectedStep = 24 / (2 * 3600 * TICKS_PER_SECOND);
    expect(afterTune.timeOfDay).toBeCloseTo(beforeTune.timeOfDay + expectedStep, 3);
  });

  it('computes deterministic daylight curve and previews time patches (wrapping 24h -> 0h)', () => {
    expect(computeDeterministicDaylight(0)).toBe(0);
    expect(computeDeterministicDaylight(6)).toBeCloseTo(0.5, 2);
    expect(computeDeterministicDaylight(12)).toBe(1);
    expect(computeDeterministicDaylight(18)).toBeCloseTo(0.5, 2);

    const host = createHost();
    const preview = previewPlanetTimePatch(host.state, { timeOfDay: 24, realHoursPerDay: 0.5, timeScale: 3 });
    expect(preview.timeOfDay).toBe(0);
    expect(preview.phase).toBe('night');
    expect(preview.daylight).toBe(0);
    expect(preview.realHoursPerDay).toBe(0.5);
    expect(preview.timeScale).toBe(3);
  });
});
