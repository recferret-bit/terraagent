import 'reflect-metadata';
import { COARSE_DT, TICK_MS, createPlanet, snapshot } from '@terra/sim';
import pino from 'pino';
import { Registry } from 'prom-client';
import { afterEach, describe, expect, it } from 'vitest';
import { MetricsRegistry } from '../../src/core/metrics.registry';
import type { AppEnv } from '../../src/core/tokens';
import type { GamePlanets, LoadOptions } from '../../src/game/game-planets.service';
import { GamePlanets as Planets } from '../../src/game/game-planets.service';
import type { SnapshotStore } from '../../src/game/persistence/snapshot-store';
import { SnapshotService } from '../../src/game/persistence/snapshot.service';
import { installRestartFastRunMetric } from '../../src/game/restart/metric';
import { RESTART_FASTRUN_MAX_TICKS, missedRestartTicks } from '../../src/game/restart/missed-ticks';
import { runCoarseCatchUp } from '../../src/game/restart/fast-run';
import { SimThreadPool } from '../../src/game/sim-thread-pool';
import { PlanetHost } from '../../src/game/thread/planet-host';

const MIN_MS = 60_000;
const HOUR_MS = 3_600_000;
const SAVED_AT = 1_700_000_000_000;
/** 10 wall minutes at 5 ticks per second (TICK_MS 200). */
const TEN_MIN_TICKS = (10 * MIN_MS) / TICK_MS;

let games: Planets | undefined;
afterEach(async () => {
  await games?.shutdown();
  games = undefined;
});

describe('missedRestartTicks', () => {
  it('turns 10 minutes of wall time into 3000 active ticks', () => {
    expect(missedRestartTicks(SAVED_AT + 10 * MIN_MS, SAVED_AT)).toEqual({ ticks: TEN_MIN_TICKS, capped: false });
    expect(TEN_MIN_TICKS).toBe(3000);
  });

  it('advances 0 when the gap is 0 or the snapshot is newer than now', () => {
    expect(missedRestartTicks(SAVED_AT, SAVED_AT)).toEqual({ ticks: 0, capped: false });
    expect(missedRestartTicks(SAVED_AT - MIN_MS, SAVED_AT)).toEqual({ ticks: 0, capped: false });
  });

  it('caps a 25 hour gap at 24 hours and keeps an exact 24 hour gap', () => {
    expect(missedRestartTicks(SAVED_AT + 24 * HOUR_MS, SAVED_AT)).toEqual({
      ticks: RESTART_FASTRUN_MAX_TICKS,
      capped: false,
    });
    expect(missedRestartTicks(SAVED_AT + 25 * HOUR_MS, SAVED_AT)).toEqual({
      ticks: RESTART_FASTRUN_MAX_TICKS,
      capped: true,
    });
    expect(RESTART_FASTRUN_MAX_TICKS).toBe(24 * 3600 * (1000 / TICK_MS));
    expect(missedRestartTicks(SAVED_AT + 25 * HOUR_MS, SAVED_AT).ticks).toBeLessThan((25 * HOUR_MS) / TICK_MS);
  });
});

describe('coarse catch-up on a loaded snapshot', () => {
  const boot = (id: string, bytes?: Uint8Array): PlanetHost => {
    const host = new PlanetHost(0, ['W00'], () => undefined);
    host.handle(
      bytes
        ? { t: 'load', planetId: id, snapshot: bytes }
        : { t: 'load', planetId: id, params: { type: 'flat', seed: 'fast', radius: 8 } },
    );
    return host;
  };

  it('steps a 10 minute gap with dt 5 and a fresh snapshot adds nothing', async () => {
    const id = 'pl_fast';
    const seeded = boot(id);
    const start = seeded.planets.get(id)!.state.meta.tick;
    const bytes = snapshot(seeded.planets.get(id)!.state);
    const host = boot(id, bytes);
    const now = SAVED_AT + 10 * MIN_MS;
    const ticks = missedRestartTicks(now, SAVED_AT).ticks;
    const dts: number[] = [];
    const ran = await runCoarseCatchUp({
      ticks,
      step: (dt) => {
        dts.push(dt);
        return host.stepPlanet(id, dt);
      },
    });
    expect(ran.completed).toBe(true);
    expect(ran.advanced).toBe(ticks);
    expect(dts.length).toBe(ticks / COARSE_DT);
    expect(dts.every((dt) => dt === COARSE_DT)).toBe(true);
    expect(host.planets.get(id)!.state.meta.tick - start).toBe(ticks);
    const fresh = snapshot(host.planets.get(id)!.state);
    const again = boot(id, fresh);
    const second = missedRestartTicks(now, now).ticks;
    expect(second).toBe(0);
    const at = again.planets.get(id)!.state.meta.tick;
    const rerun = await runCoarseCatchUp({ ticks: second, step: (dt) => again.stepPlanet(id, dt) });
    expect(rerun.advanced).toBe(0);
    expect(again.planets.get(id)!.state.meta.tick).toBe(at);
  }, 60_000);

  it('does not call step when the gap is 0', async () => {
    let calls = 0;
    const ran = await runCoarseCatchUp({
      ticks: missedRestartTicks(SAVED_AT, SAVED_AT).ticks,
      step: () => {
        calls += 1;
        return true;
      },
    });
    expect(ran).toEqual({ steps: 0, advanced: 0, completed: true });
    expect(calls).toBe(0);
  });
});

describe('sim thread restart fast-run', () => {
  it('catches a loaded snapshot up, stays active, and a later snapshot does not run again', async () => {
    const pool = new SimThreadPool({ threads: 1, flags: ['W00'], autoStep: false });
    await pool.start();
    const g = (games = new Planets(pool));
    const id = 'pl_thread_fast';
    const state = createPlanet({ type: 'flat', seed: 'fast', radius: 8, planetId: id });
    const start = state.meta.tick;
    const ticks = missedRestartTicks(SAVED_AT + 10 * MIN_MS, SAVED_AT).ticks;
    const got = await g.load(id, { snapshot: snapshot(state), catchUpTicks: ticks });
    expect(got - start).toBe(ticks);
    const [thread] = await pool.stats();
    expect(thread!.planets.map((p) => p.planetId)).toContain(id);
    expect(thread!.planets.find((p) => p.planetId === id)!.mode).toBe('active');
    expect(thread!.planets.find((p) => p.planetId === id)!.tick - start).toBe(ticks);
    const end = await new Promise<Uint8Array>((resolve) => {
      g.onPlanetSnapshot((pid, snap) => {
        if (pid === id) resolve(snap.bytes);
      });
      g.requestSnapshot(id);
    });
    const second = await g.load('pl_thread_fast_2', { snapshot: end });
    expect(second - start).toBe(ticks);
  }, 60_000);
});

describe('SnapshotService passes the capped gap', () => {
  const raw = (id: string): Uint8Array =>
    snapshot(createPlanet({ id, seed: 'fast', type: 'temperate', planetType: 'temperate', radius: 8 }));

  it('injects 10 minutes, ignores a zero gap, and caps 25 hours', async () => {
    const now = Date.now();
    const saved = {
      pl_ten: new Date(now - 10 * MIN_MS),
      pl_zero: new Date(now),
      pl_long: new Date(now - 25 * HOUR_MS),
    };
    const loads: { id: string; opts: LoadOptions }[] = [];
    const requested: string[] = [];
    const store = {
      livePlanetIds: async () => Object.keys(saved),
      latest: async (id: string) => ({ raw: raw(id), savedAt: saved[id as keyof typeof saved] }),
      wipePlanet: async () => {},
    } as unknown as SnapshotStore;
    const planets = {
      onPlanetLoaded: () => {},
      onPlanetUnloaded: () => {},
      onPlanetSnapshot: () => {},
      loadedIds: () => [],
      markScenarioColonyPlanet: () => {},
      requestSnapshot: (id: string) => {
        requested.push(id);
      },
      load: async (id: string, opts: LoadOptions = {}) => {
        loads.push({ id, opts });
        return 0;
      },
    } as unknown as GamePlanets;
    const env = { SNAPSHOTS: 'on', SNAPSHOT_EVERY_S: 60, NODE_ENV: 'test' } as unknown as AppEnv;
    const svc = new SnapshotService(planets, store, new MetricsRegistry(), env, pino({ level: 'silent' }));
    svc.nowMs = () => now;
    await svc.restoreAll();
    const byId = Object.fromEntries(loads.map((l) => [l.id, l.opts.catchUpTicks]));
    expect(byId.pl_ten).toBe(TEN_MIN_TICKS);
    expect(byId.pl_zero).toBeUndefined();
    expect(byId.pl_long).toBe(RESTART_FASTRUN_MAX_TICKS);
    expect(requested.sort()).toEqual(['pl_long', 'pl_ten']);
  });
});

describe('restart_fastrun_seconds', () => {
  it('records the wall time of a catch-up', async () => {
    const registry = new Registry();
    let hear: (planetId: string, seconds: number, ticks: number) => void = () => {};
    installRestartFastRunMetric(
      {
        onFastRun: (fn) => {
          hear = fn;
        },
      },
      registry,
    );
    hear('pl_x', 0.25, TEN_MIN_TICKS);
    const text = await registry.metrics();
    expect(text).toContain('restart_fastrun_seconds_sum{planet="pl_x"} 0.25');
  });
});
