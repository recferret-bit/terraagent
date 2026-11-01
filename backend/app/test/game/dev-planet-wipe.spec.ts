import { createPlanet, encodeValue, GEN_VERSION, SIM_VERSION, snapshot, type PlanetState } from '@terra/sim';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { MetricsRegistry } from '../../src/core/metrics.registry';
import type { AppEnv } from '../../src/core/tokens';
import type { GamePlanets } from '../../src/game/game-planets.service';
import { devSnapshotVerdict } from '../../src/game/persistence/dev-planet-verdict';
import type { SnapshotStore } from '../../src/game/persistence/snapshot-store';
import { SnapshotService } from '../../src/game/persistence/snapshot.service';

const planet = (id: string, planetType: 'desert' | 'ocean' | 'temperate', patch?: (s: PlanetState) => void): Uint8Array => {
  const s = createPlanet({ id, seed: 'wipe-spec', type: 'temperate', planetType, radius: 8 });
  patch?.(s);
  return snapshot(s);
};

/** A snapshot whose header claims a sim version this engine does not know yet. */
const fromNewerSim = (id: string): Uint8Array => {
  const s = createPlanet({ id, seed: 'wipe-spec', type: 'temperate', planetType: 'desert', radius: 8 });
  return encodeValue({ header: { simVersion: SIM_VERSION + 1, codec: 'msgpack', tick: 0, planetId: id }, state: s });
};

describe('devSnapshotVerdict (D-38 dev planet wipe)', () => {
  it('keeps a current dev planet of its family type', () => {
    expect(devSnapshotVerdict('pl_dev', planet('pl_dev', 'desert')).kind).toBe('keep');
    expect(devSnapshotVerdict('pl_dev_ocean', planet('pl_dev_ocean', 'ocean')).kind).toBe('keep');
  });
  it('wipes a dev planet from an older generator, with no generator version, or of another type than its id', () => {
    expect(devSnapshotVerdict('pl_dev', planet('pl_dev', 'desert', (s) => { s.meta.genVersion = GEN_VERSION - 1; })).kind).toBe('wipe');
    expect(devSnapshotVerdict('pl_dev', planet('pl_dev', 'desert', (s) => { delete s.meta.genVersion; })).kind).toBe('wipe');
    expect(devSnapshotVerdict('pl_dev', planet('pl_dev', 'temperate')).kind).toBe('wipe');
  });
  it('never wipes a snapshot written by a newer build (sim or generator version above this engine)', () => {
    expect(devSnapshotVerdict('pl_dev', planet('pl_dev', 'desert', (s) => { s.meta.genVersion = GEN_VERSION + 1; })).kind).toBe('newer');
    expect(devSnapshotVerdict('pl_dev', fromNewerSim('pl_dev')).kind).toBe('newer');
  });
  it('never judges a non-dev planet', () => {
    expect(devSnapshotVerdict('pl_scenario', planet('pl_scenario', 'temperate', (s) => { s.meta.genVersion = 0; })).kind).toBe('keep');
  });
});

describe('SnapshotService.restoreAll with old / foreign / newer dev planets', () => {
  it('wipes old and wrong-type dev planets, skips newer ones, restores the rest, never wipes a non-dev planet', async () => {
    const snaps: Record<string, Uint8Array> = {
      pl_dev: planet('pl_dev', 'desert', (s) => { s.meta.genVersion = GEN_VERSION - 1; }), // old ground
      pl_dev_2: planet('pl_dev_2', 'temperate'), // wrong type for the desert family
      pl_dev_3: planet('pl_dev_3', 'desert', (s) => { s.meta.genVersion = GEN_VERSION + 1; }), // newer build
      pl_dev_4: fromNewerSim('pl_dev_4'), // newer sim
      pl_dev_ocean: planet('pl_dev_ocean', 'ocean'), // current
      pl_scn: planet('pl_scn', 'temperate', (s) => { s.meta.genVersion = 0; }), // not a dev planet
    };
    const wiped: string[] = [];
    const loaded: string[] = [];
    const store = {
      livePlanetIds: async () => Object.keys(snaps),
      latest: async (id: string) => ({ raw: snaps[id], savedAt: new Date(0) }),
      wipeDevPlanet: async (id: string) => { wiped.push(id); },
    } as unknown as SnapshotStore;
    const planets = {
      onPlanetLoaded: () => () => {}, onPlanetUnloaded: () => () => {}, onPlanetSnapshot: () => () => {},
      loadedIds: () => [], requestSnapshot: () => {}, markScenarioColonyPlanet: () => {},
      load: async (id: string) => { loaded.push(id); return 0; },
    } as unknown as GamePlanets;
    const env = { SNAPSHOTS: 'on', SNAPSHOT_EVERY_S: 60, NODE_ENV: 'test' } as unknown as AppEnv;
    const svc = new SnapshotService(planets, store, new MetricsRegistry(), env, pino({ level: 'silent' }));
    const restored = await svc.restoreAll();
    expect(wiped.sort()).toEqual(['pl_dev', 'pl_dev_2']);
    expect(loaded.sort()).toEqual(['pl_dev_ocean', 'pl_scn']);
    expect(restored.sort()).toEqual(['pl_dev_ocean', 'pl_scn']);
  });
});
