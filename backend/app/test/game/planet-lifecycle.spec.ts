import { CANONICAL_PLANETS } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import { idleUnloadEligible, isIdle, lifecycleConfig, MIN_IDLE_MS } from '../../src/game/lifecycle/idle-policy';
import { unloadIdlePlanet, type IdleUnloadDeps } from '../../src/game/lifecycle/idle-unloader';
import { MemoryPlanetActivity } from '../../src/game/lifecycle/planet-activity.store';
import { planetCapacityGate } from '../../src/game/lifecycle/planet-cap';
import { PlanetJobsService } from '../../src/game/lifecycle/planet-jobs.service';
import { ManualPresenceClock } from '../../src/game/presence/clock';
import { PLANET_SEEN_HEARTBEAT_MS, PlanetSeenWriter } from '../../src/game/presence/planet-seen';
import { PresenceTracker } from '../../src/game/presence/tracker';
import { memoryJobs } from '../../src/jobs/jobs.service';
import { eventually } from '../jobs/job-queue.contract';

const IDLE = 60_000;

function unloadRig(opts: { enabled?: boolean; savedLate?: boolean } = {}) {
  const calls: string[] = [];
  const loaded = new Set(['pl_dev_2']);
  const store = new MemoryPlanetActivity();
  let now = 1_000_000;
  const deps: IdleUnloadDeps = {
    snapshots: { enabled: opts.enabled ?? true, capture: async (id, kind) => { calls.push(`capture:${id}:${kind}`); } },
    planets: { isLoaded: (id) => loaded.has(id), unload: async (id) => { calls.push(`unload:${id}`); loaded.delete(id); } },
    sectorState: { flushPlanet: async (id) => { calls.push(`flush:${id}`); } },
    store,
    latestSnapshotAt: async () => new Date(opts.savedLate === false ? 0 : Date.now() + 1),
    quietLease: async (id) => { calls.push(`lease:${id}`); },
    idleMs: IDLE,
    now: () => now,
  };
  return { deps, calls, loaded, store, setNow: (t: number) => { now = t; } };
}

describe('idle unload part', () => {
  it('SEAL snapshot first, then dormant mark, sector flush, unload and a quiet lease', async () => {
    const r = unloadRig();
    await r.store.touch('pl_dev_2', new Date(0));
    expect(await unloadIdlePlanet(r.deps, 'pl_dev_2')).toBe('unloaded');
    expect(r.calls).toEqual(['capture:pl_dev_2:SEAL', 'flush:pl_dev_2', 'unload:pl_dev_2', 'lease:pl_dev_2']);
    expect((await r.store.get('pl_dev_2'))?.dormantSince).toBeInstanceOf(Date);
    expect(await r.store.dormantIds()).toEqual(['pl_dev_2']);
  });

  it('never unloads with persistence off', async () => {
    const r = unloadRig({ enabled: false });
    expect(await unloadIdlePlanet(r.deps, 'pl_dev_2')).toBe('persistence_off');
    expect(r.calls).toEqual([]);
    expect(r.loaded.has('pl_dev_2')).toBe(true);
  });

  it('throws (the job retries) and keeps the planet when the SEAL row was not stored', async () => {
    const r = unloadRig({ savedLate: false });
    await expect(unloadIdlePlanet(r.deps, 'pl_dev_2')).rejects.toThrow(/no SEAL snapshot/);
    expect(r.loaded.has('pl_dev_2')).toBe(true);
    expect(await r.store.dormantIds()).toEqual([]);
  });

  it('keeps the planet when a human came back while the snapshot was written', async () => {
    const r = unloadRig();
    await r.store.touch('pl_dev_2', new Date(1_000_000)); // seen "now"
    expect(await unloadIdlePlanet(r.deps, 'pl_dev_2')).toBe('human_returned');
    expect(r.loaded.has('pl_dev_2')).toBe(true);
  });
});

describe('idle policy', () => {
  it('player planets are eligible; canonical, scenario and spectator planets are not', () => {
    expect(idleUnloadEligible('pl_dev_ocean_3', () => false)).toBe(true);
    expect(idleUnloadEligible(CANONICAL_PLANETS.desert.id, () => false)).toBe(false);
    expect(idleUnloadEligible('pl_scn', () => true)).toBe(false);
    expect(idleUnloadEligible('pl_spec_1', () => false)).toBe(false);
  });

  it('idle is inclusive at the threshold, and 0 turns it off', () => {
    expect(isIdle({ lastHumanSeenAt: new Date(0) }, IDLE, IDLE)).toBe(true);
    expect(isIdle({ lastHumanSeenAt: new Date(1) }, IDLE, IDLE)).toBe(false);
    expect(isIdle({ lastHumanSeenAt: new Date(0) }, 10 * IDLE, 0)).toBe(false);
  });

  it('the cap defaults to 4 per sim thread; idle 24 h, checked every 5 min', () => {
    expect(lifecycleConfig({ SIM_THREADS: 3 })).toEqual({ cap: 12, idleMs: 24 * 3_600_000, checkMs: 300_000 });
    expect(lifecycleConfig({ SIM_THREADS: 3, TA_PLANET_CAP: 5, TA_PLANET_IDLE_UNLOAD_H: 0 })).toMatchObject({ cap: 5, idleMs: 0 });
    // outside tests the idle time is never shorter than three presence heartbeats (a connected player is never idle)
    expect(lifecycleConfig({ NODE_ENV: 'production', TA_PLANET_IDLE_UNLOAD_H: 0.001 }).idleMs).toBe(MIN_IDLE_MS);
  });
});

describe('activity store (the persisted idle clock)', () => {
  it('never moves the clock back; wake clears dormant only for a dormant planet', async () => {
    const s = new MemoryPlanetActivity();
    await s.touch('p', new Date(500));
    await s.touch('p', new Date(100));
    expect((await s.get('p'))?.lastHumanSeenAt.getTime()).toBe(500);
    expect((await s.ensure('p', new Date(900))).lastHumanSeenAt.getTime()).toBe(500); // ensure keeps an existing clock
    expect(await s.wake('p', new Date(1_000))).toBe(false); // not dormant: a boot restore does not reset the clock
    expect((await s.get('p'))?.lastHumanSeenAt.getTime()).toBe(500);
    await s.markDormant('p', new Date(2_000));
    expect(await s.wake('p', new Date(3_000))).toBe(true);
    expect(await s.get('p')).toMatchObject({ dormantSince: null, lastHumanSeenAt: new Date(3_000) });
  });
});

describe('presence persists "last human seen" (3.5)', () => {
  it('stamps on the first join, every heartbeat while occupied, and when the last socket leaves', async () => {
    const clock = new ManualPresenceClock();
    const touches: [string, number][] = [];
    const writer = new PlanetSeenWriter({ touch: async (id, at) => { touches.push([id, at.getTime()]); } }, clock);
    const tracker = new PresenceTracker({
      clock, commands: { submit: async () => ({ ok: true }) }, lastSeen: { touch: async () => ({}) }, planetSeen: writer,
    });
    tracker.join({ socketId: 's1', planetId: 'pl_dev', colonyId: 'c1', playerId: 'p1' });
    tracker.join({ socketId: 's2', planetId: 'pl_dev', colonyId: 'c2', playerId: 'p2' });
    expect(touches).toEqual([['pl_dev', 0]]);
    clock.advance(PLANET_SEEN_HEARTBEAT_MS);
    expect(touches).toEqual([['pl_dev', 0], ['pl_dev', PLANET_SEEN_HEARTBEAT_MS]]);
    tracker.close('s1');
    expect(touches).toHaveLength(2); // one socket remains
    clock.advance(1_000);
    tracker.close('s2');
    expect(touches.at(-1)).toEqual(['pl_dev', PLANET_SEEN_HEARTBEAT_MS + 1_000]);
    clock.advance(PLANET_SEEN_HEARTBEAT_MS * 3);
    expect(touches).toHaveLength(3); // no heartbeat for an empty planet
    tracker.stop();
  });
});

describe('planet jobs (3.8, 4): one job per planet, on the holder', () => {
  it('never runs one planet twice at once in this process, even if the queue hands it out twice', async () => {
    const jobs = memoryJobs();
    let active = 0;
    let maxActive = 0;
    let runs = 0;
    let finish!: () => void;
    const svc = new PlanetJobsService({ loadedIds: () => ['pl_a'], isLoaded: () => true }, jobs);
    svc.register({ name: 'test.overlap', everyMs: 60_000, concurrency: 2, run: () => new Promise<void>((resolve) => {
      runs++;
      maxActive = Math.max(maxActive, ++active);
      finish = () => { active--; resolve(); };
    }) });
    jobs.onApplicationBootstrap();
    await jobs.whenStarted();
    const name = jobs.queueFor('test.overlap', 'instance');
    await jobs.port.enqueue(name, { planetId: 'pl_a' }); // no singleton key: as a job the queue failed while it still ran
    await eventually(() => runs === 1);
    await jobs.port.enqueue(name, { planetId: 'pl_a' });
    await new Promise((r) => setTimeout(r, 150));
    expect(runs).toBe(1); // the second hand-out returned at once instead of running beside the first
    finish();
    expect(maxActive).toBe(1);
    await jobs.onModuleDestroy();
  });

  it('fan-out defines its queue first, so an enqueue can never create it with the default policy', async () => {
    const jobs = memoryJobs();
    const defined: Array<{ name: string; policy?: string }> = [];
    const define = jobs.define.bind(jobs);
    jobs.define = (def) => { defined.push({ name: def.name, policy: def.policy }); return define(def); };
    const svc = new PlanetJobsService({ loadedIds: () => ['pl_a'], isLoaded: () => true }, jobs);
    jobs.onApplicationBootstrap();
    await jobs.whenStarted();
    const queue = { name: 'test.fresh/test', policy: 'stately' as const };
    expect(await svc.fanOut(queue, {})).toBe(1);
    expect(defined[0]).toEqual({ name: 'test.fresh/test', policy: 'stately' });
    await jobs.onModuleDestroy();
  });

  it('fans out one job per locally loaded, eligible planet and skips planets that left this process', async () => {
    const jobs = memoryJobs();
    const loaded = new Set(['pl_a', 'pl_b', 'pl_spec_1']);
    const ran: string[] = [];
    const svc = new PlanetJobsService({ loadedIds: () => [...loaded], isLoaded: (id) => loaded.has(id) }, jobs);
    svc.register({ name: 'test.planet', everyMs: 60_000, eligible: (id) => !id.startsWith('pl_spec_'), run: async (id) => { ran.push(id); } });
    jobs.onApplicationBootstrap();
    await jobs.whenStarted();
    const queue = { name: jobs.queueFor('test.planet', 'instance'), policy: 'stately' as const };
    loaded.delete('pl_b');
    expect(await svc.fanOut(queue, { eligible: (id) => !id.startsWith('pl_spec_') })).toBe(1);
    await eventually(() => ran.length === 1);
    expect(ran).toEqual(['pl_a']);
    await jobs.onModuleDestroy();
  });

  it('registers nothing on an api replica (it holds no planet)', async () => {
    const jobs = memoryJobs({ simRole: 'api' });
    new PlanetJobsService({ loadedIds: () => ['pl_a'], isLoaded: () => true }, jobs).register({ name: 'test.api', everyMs: 1_000, run: async () => undefined });
    jobs.onApplicationBootstrap();
    await jobs.whenStarted();
    expect(await jobs.port.stats()).toEqual([]);
    await jobs.onModuleDestroy();
  });
});

describe('planet cap gate', () => {
  it('counts loaded planets cluster-wide from the live leases plus its own', async () => {
    const gate = planetCapacityGate(12, { loadedIds: () => ['pl_a'] }, {
      enabled: true,
      findActiveLeases: async () => [{ planetId: 'pl_b' }, { planetId: 'pl_a' }] as never,
    });
    expect(gate.cap).toBe(12);
    expect([...(await gate.loadedPlanetIds())].sort()).toEqual(['pl_a', 'pl_b']);
  });
});
