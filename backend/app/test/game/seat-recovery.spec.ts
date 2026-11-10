import { newId } from '@terra/contracts';
import { createPlanet, DEV_PLANET_RADIUS, DEV_PLANET_SEED, DEV_PLANET_TYPE, snapshot } from '@terra/sim';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { HomeRepository } from '../../src/core/home/home.repository';
import { MetricsRegistry } from '../../src/core/metrics.registry';
import type { AppEnv } from '../../src/core/tokens';
import { bridgePlanetEvents } from '../../src/game/bus-bridge';
import type { GamePlanets, PlanetEventsListener } from '../../src/game/game-planets.service';
import { gameLandingHost } from '../../src/game/home-landing-host';
import type { SnapshotStore } from '../../src/game/persistence/snapshot-store';
import { PlanetHeldError, RECOVER_LIMIT, SnapshotService } from '../../src/game/persistence/snapshot.service';
import { PlanetHost } from '../../src/game/thread/planet-host';
import type { FromThread } from '../../src/game/thread/protocol';

const ON = { SNAPSHOTS: 'on', SNAPSHOT_EVERY_S: 60, NODE_ENV: 'test' } as unknown as AppEnv;
const silent = pino({ level: 'silent' });

function fakePlanets(loadedIds: string[] = []) {
  const loaded = new Set(loadedIds);
  const marked: string[] = [];
  const loads: string[] = [];
  const planets = {
    onPlanetLoaded: () => () => {}, onPlanetUnloaded: () => () => {}, onPlanetSnapshot: () => () => {},
    requestSnapshot: () => {},
    isLoaded: (id: string) => loaded.has(id), markScenarioColonyPlanet: (id: string) => { marked.push(id); },
    load: async (id: string) => { loads.push(id); loaded.add(id); return 0; },
    ensureLoaded: async (id: string) => { loads.push(`new:${id}`); loaded.add(id); return 0; },
  } as unknown as GamePlanets;
  return { planets, marked, loads, loaded };
}

function fakeStore(snaps: Record<string, Uint8Array>) {
  const wiped: string[] = [];
  const store = {
    hasSnapshots: async (id: string) => id in snaps,
    latest: async (id: string) => (snaps[id] ? { raw: snaps[id], savedAt: new Date(0) } : null),
    livePlanetIds: async () => Object.keys(snaps),
    wipePlanet: async (id: string) => { wiped.push(id); delete snaps[id]; },
  } as unknown as SnapshotStore;
  return { store, wiped };
}

const withColony = (id: string) => {
  const s = createPlanet({ id, seed: 's', type: 'temperate', planetType: 'temperate', radius: 8 });
  s.colonies.push({ index: 0, status: 'active' } as never);
  return snapshot(s);
};

describe('PlanetHost answers landingSite from the live sim (LED-14)', () => {
  it('gives the next free site of a colony index, and already_landed once that index landed', () => {
    const out: FromThread[] = [];
    const host = new PlanetHost(0, ['W00', 'W01'], (m) => out.push(m));
    host.handle({ t: 'load', planetId: 'pl_S', params: { type: DEV_PLANET_TYPE, seed: DEV_PLANET_SEED, radius: DEV_PLANET_RADIUS, capacity: 5 } });
    host.handle({ t: 'landingSite', planetId: 'pl_S', reqId: 1, colony: 0 });
    const first = out.at(-1) as Extract<FromThread, { t: 'landingSite' }>;
    expect(first).toMatchObject({ t: 'landingSite', planetId: 'pl_S', reqId: 1, answer: { ok: true, slotIndex: 0 } });
    const site = first.answer as { q: number; r: number };
    host.handle({
      t: 'cmd', planetId: 'pl_S',
      cmd: { colonyIndex: 0, source: 'system', commandId: newId('cm'), kind: 'system.spawnColony', args: { colonyId: 'col_s', colonyIndex: 0, name: 'S', slotIndex: 0, q: site.q, r: site.r } },
    } as never);
    host.stepPlanet('pl_S', 1);
    expect(out.some((m) => m.t === 'ack')).toBe(true);
    host.handle({ t: 'landingSite', planetId: 'pl_S', reqId: 2, colony: 0 });
    expect(out.at(-1)).toEqual({ t: 'landingSite', planetId: 'pl_S', reqId: 2, answer: { ok: false, code: 'already_landed' } });
    host.handle({ t: 'landingSite', planetId: 'pl_none', reqId: 3, colony: 0 });
    expect(out.at(-1)).toEqual({ t: 'landingSite', planetId: 'pl_none', reqId: 3, answer: { ok: false, code: 'planet_not_loaded' } });
  });
});

describe('SnapshotService: home loads, recovery and wipe', () => {
  it('loadHome restores a planet with snapshots, generates one without, and holds an unrestorable one (BE-14)', async () => {
    const snaps: Record<string, Uint8Array> = { pl_saved: withColony('pl_saved'), pl_bad: new Uint8Array([9, 9]) };
    const { planets, loads } = fakePlanets();
    const svc = new SnapshotService(planets, fakeStore(snaps).store, new MetricsRegistry(), ON, silent);
    expect(await svc.loadHome('pl_saved', {})).toBe('restored');
    expect(await svc.loadHome('pl_saved', {})).toBe('loaded');
    expect(await svc.loadHome('pl_fresh', { params: { type: 'desert' } })).toBe('generated');
    await expect(svc.loadHome('pl_bad', {})).rejects.toBeInstanceOf(PlanetHeldError);
    expect(loads).toEqual(['pl_saved', 'new:pl_fresh']);
  });

  it('a restored planet with colony rows is not marked as a scenario planet; one without rows is (BE-07)', async () => {
    const snaps = { pl_rows: withColony('pl_rows'), pl_scn: withColony('pl_scn') };
    const { planets, marked } = fakePlanets();
    const homes = new HomeRepository();
    await homes.createColony({ playerId: 'pr_1', planetId: 'pl_rows', colonyIndex: 0, name: 'Mine', spawnQ: 0, spawnR: 0 });
    const svc = new SnapshotService(planets, fakeStore(snaps).store, new MetricsRegistry(), ON, silent, undefined, homes);
    await svc.restoreAll();
    expect(marked).toEqual(['pl_scn']);
  });

  it('recover restores a downed planet from its snapshot at most RECOVER_LIMIT times per window (BE-11/BE-12)', async () => {
    const { planets, loads, loaded } = fakePlanets();
    const svc = new SnapshotService(planets, fakeStore({ pl_x: withColony('pl_x') }).store, new MetricsRegistry(), ON, silent);
    for (let i = 0; i < RECOVER_LIMIT + 1; i++) {
      loaded.delete('pl_x');
      expect(await svc.recover(['pl_x'], 1000 + i)).toEqual(i < RECOVER_LIMIT ? ['pl_x'] : []);
    }
    expect(loads).toEqual(Array(RECOVER_LIMIT).fill('pl_x'));
    expect(await svc.recover(['pl_none'])).toEqual([]); // no snapshot: stays unloaded
  });

  it('wipe deletes an unloaded planet with its colony rows, refuses a loaded one (LED-06)', async () => {
    const { planets } = fakePlanets(['pl_live']);
    const homes = new HomeRepository();
    const { colony } = await homes.createColony({ playerId: 'pr_w', planetId: 'pl_held', colonyIndex: 0, name: 'W', spawnQ: 0, spawnR: 0 });
    const { store, wiped } = fakeStore({ pl_held: new Uint8Array([1]) });
    const svc = new SnapshotService(planets, store, new MetricsRegistry(), ON, silent, undefined, homes);
    await expect(svc.wipe('pl_live')).rejects.toThrow(/is loaded/);
    await svc.wipe('pl_held');
    expect(wiped).toEqual(['pl_held']);
    expect(homes.findCachedColonyById(colony.id)).toBeNull();
    expect(await homes.listColoniesByPlanetId('pl_held')).toEqual([]);
  });
});

describe('gameLandingHost', () => {
  it('lands the live colony rows again on a home planet generated fresh (no snapshot, BE-14)', async () => {
    const homes = new HomeRepository();
    const planet = await homes.upsertDevPlanet('pl_dev');
    await homes.createColony({ playerId: 'pr_a', planetId: 'pl_dev', colonyIndex: 0, name: 'A', spawnQ: 4, spawnR: 5 });
    await homes.createColony({ playerId: 'pr_b', planetId: 'pl_dev', colonyIndex: 1, name: 'B', status: 'ELIMINATED', spawnQ: 9, spawnR: 9 });
    const submitted: Array<{ colonyIndex: number; q: unknown; r: unknown }> = [];
    const seat = {
      ensureLoaded: async () => 0,
      submit: async (_p: string, c: { colonyIndex: number | null; commandId: string; args: { q?: unknown; r?: unknown } }) => {
        submitted.push({ colonyIndex: c.colonyIndex as number, q: c.args.q, r: c.args.r });
        return { ok: true as const, commandId: c.commandId, appliedAtTick: 1 };
      },
    };
    let outcome: 'generated' | 'restored' = 'generated';
    const host = gameLandingHost({ loadNew: async () => {}, loadHome: async () => outcome }, { landingSite: async () => ({ ok: false, code: 'x' }) }, seat as never);
    await host.ensureHomeLoaded(planet, () => homes.listColoniesByPlanetId('pl_dev'));
    expect(submitted).toEqual([{ colonyIndex: 0, q: 4, r: 5 }]);
    outcome = 'restored';
    await host.ensureHomeLoaded(planet, () => homes.listColoniesByPlanetId('pl_dev'));
    expect(submitted).toHaveLength(1);
  });
});

describe('bus bridge (BE-13)', () => {
  it('logs and skips an event the bus refuses instead of throwing inside the thread listener', () => {
    let listener: PlanetEventsListener | undefined;
    const planets = { onEvents: (l: PlanetEventsListener) => { listener = l; return () => {}; } } as unknown as GamePlanets;
    const bus = { emit: () => { throw new Error('planet.event "hqLanded": invalid data'); } };
    const errors: string[] = [];
    const forwarder = { forwardStep: () => { throw new Error('forwarder bug'); } };
    bridgePlanetEvents(planets, bus as never, forwarder as never, { error: (_o: unknown, msg: string) => { errors.push(msg); } } as never);
    expect(() => listener!('pl_b', [{ kind: 'hqLanded', severity: 'info', atTick: 1, colonyIds: [], data: { bad: 1 } }])).not.toThrow();
    expect(errors).toEqual(['bus bridge: progression batch dropped', 'bus bridge: event hqLanded dropped']);
  });
});
