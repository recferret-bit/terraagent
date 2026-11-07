import { decodeValue, encodeValue, SIM_VERSION, type PlanetState } from '@terra/sim';
import { describe, expect, it } from 'vitest';
import { LocalHostCore, type LocalHostDeps } from './LocalHostCore';
import { compatible, memorySnapshotStore, snapshotKey } from './snapshotStore';

describe('version 2 local save migration', () => {
  it('resumes the existing planet, tick, entities, overrides and journal instead of regenerating', async () => {
    const store = memorySnapshotStore();
    const deps: LocalHostDeps = {
      now: () => 0, wallMs: () => 1234, schedule: () => () => {}, store,
    };
    const core = await LocalHostCore.create({ scenario: 'w00' }, deps, () => {});
    await core.devCommand('tune', { op: 'set', path: 'dev.probe.nudgeTiles', value: 3 });
    core.simHost.submit({ kind: 'dev.spawn', args: { q: 2, r: -1 }, colonyIndex: 0, source: 'dev', commandId: 'cm_migrate' });
    core.simHost.step(5);
    core.stop();
    await Promise.resolve();
    const key = snapshotKey('w00'), saved = store.map.get(key)!;
    const raw = decodeValue(saved.bytes) as { header: { simVersion: number }; state: PlanetState };
    raw.header.simVersion = raw.state.meta.simVersion = 2;
    const legacy = { ...saved, simVersion: 2, bytes: encodeValue(raw) };
    store.map.set(key, legacy);
    const expected = { simVersion: SIM_VERSION, dataHash: saved.dataHash, flags: saved.flags };
    expect(compatible(legacy, expected)).toBe(true);
    expect(compatible({ ...legacy, simVersion: 1 }, expected)).toBe(false);
    expect(compatible({ ...legacy, simVersion: SIM_VERSION + 1 }, expected)).toBe(false);
    expect(compatible({ ...legacy, dataHash: 'different' }, expected)).toBe(false);
    const resumed = await LocalHostCore.create({ scenario: 'w00' }, deps, () => {});
    expect(resumed.planetId).toBe(core.planetId);
    expect(resumed.tick).toBe(saved.tick);
    expect(resumed.simHost.state).toEqual(core.simHost.state);
    resumed.stop();
    await Promise.resolve();
    expect(store.map.get(key)).toMatchObject({ simVersion: SIM_VERSION, overrides: saved.overrides, journal: saved.journal });
  });
});
