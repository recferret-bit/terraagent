import 'reflect-metadata';
import { DEV_PLANET_RADIUS, DEV_PLANET_SEED, DEV_PLANET_TYPE } from '@terra/sim';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { devPlanetIds } from '../../src/game/dev-planets';
import { GamePlanets, type PlanetDownReason } from '../../src/game/game-planets.service';
import { SimThreadPool } from '../../src/game/sim-thread-pool';
import { PlanetHost } from '../../src/game/thread/planet-host';
import type { FromThread } from '../../src/game/thread/protocol';
import faultModule from './fixtures/fault-module';

const ALL_WAVES = Array.from({ length: 21 }, (_, i) => `W${String(i).padStart(2, '0')}`);
const FAULT = new URL('./fixtures/fault-module.ts', import.meta.url).href;
const cmd = (kind: string, commandId: string) => ({ colonyIndex: null, source: 'dev' as const, commandId, kind, args: {} });

let games: GamePlanets | undefined;
async function boot(threads: number) {
  const pool = new SimThreadPool({ threads, flags: ALL_WAVES, simModules: [FAULT] });
  await pool.start();
  const g = (games = new GamePlanets(pool));
  const down: Array<[string, PlanetDownReason]> = [];
  const threadsDown: Array<[number, readonly string[]]> = [];
  const unloaded: string[] = [];
  g.onPlanetDown((id, reason) => down.push([id, reason]));
  g.onThreadDown((t, ids) => threadsDown.push([t, ids]));
  g.onPlanetUnloaded((id) => unloaded.push(id));
  return { g, pool, down, threadsDown, unloaded };
}
afterEach(async () => { await games?.shutdown(); games = undefined; });

describe('a step that throws (BE-12)', () => {
  it('rejects the step\'s commands internal, drops the planet and reports it down; other planets keep running', async () => {
    const { g, down, unloaded } = await boot(1);
    const [bad, good] = devPlanetIds(2, 1) as [string, string];
    await Promise.all([g.load(bad), g.load(good)]);
    const [boom, sibling] = await Promise.all([g.submit(bad, cmd('test.throw', 'c_boom')), g.submit(bad, cmd('dev.ping', 'c_sib'))]);
    expect(boom).toEqual({ ok: false, commandId: 'c_boom', code: 'internal' });
    expect(sibling).toEqual({ ok: false, commandId: 'c_sib', code: 'internal' });
    await vi.waitFor(() => expect(down).toEqual([[bad, 'step_failed']])); // `planetFailed` follows the rejects
    expect(unloaded).toEqual([bad]);
    expect(g.isLoaded(bad)).toBe(false);
    expect(await g.submit(bad, cmd('dev.ping', 'c_after'))).toMatchObject({ ok: false, code: 'planet_not_loaded' });
    expect(await g.submit(good, cmd('dev.ping', 'c_good'))).toMatchObject({ ok: true });
  });
});

describe('PlanetHost: a step that throws after its commands were applied (BE-12, LED-09)', () => {
  const spawn = (commandId: string) => ({
    colonyIndex: 0, source: 'system' as const, commandId, kind: 'system.spawnColony',
    args: { colonyId: 'col_f', colonyIndex: 0, name: 'F', slotIndex: 0 },
  });

  it('posts the failed step\'s postings, answers its outcomes, rejects only the rest internal, then planetFailed', () => {
    const out: FromThread[] = [];
    const host = new PlanetHost(0, ['W00', 'W01'], (m) => out.push(m), undefined, { modules: [faultModule] });
    host.handle({ t: 'load', planetId: 'pl_F', params: { type: DEV_PLANET_TYPE, seed: DEV_PLANET_SEED, radius: DEV_PLANET_RADIUS, capacity: 5 } });
    out.length = 0;
    for (const c of [spawn('c_land'), cmd('test.reject', 'c_rej'), cmd('test.armSystemThrow', 'c_arm')]) host.handle({ t: 'cmd', planetId: 'pl_F', cmd: c });
    expect(host.stepPlanet('pl_F', 1)).toBe(false);
    expect(out.map((m) => m.t)).toEqual(['ledger', 'ack', 'reject', 'ack', 'planetFailed']);
    const ledger = out[0] as Extract<FromThread, { t: 'ledger' }>;
    expect(ledger.tick).toBe(1);
    expect(ledger.postings.map((p) => p.reason)).toEqual(['landing.cargo']);
    expect(out.slice(1, 4)).toEqual([
      { t: 'ack', planetId: 'pl_F', commandId: 'c_land', appliedAtTick: 1 },
      { t: 'reject', planetId: 'pl_F', commandId: 'c_rej', code: 'site_blocked', appliedAtTick: 1, detail: 'trees on 2 tiles' },
      { t: 'ack', planetId: 'pl_F', commandId: 'c_arm', appliedAtTick: 1 },
    ]);
    expect(out[4]).toEqual({ t: 'planetFailed', planetId: 'pl_F', message: 'step to tick 1 failed: system boom' });
    expect(host.planets.has('pl_F')).toBe(false);
  });

  it('passes a handler\'s reject detail on a normal step (GP-31)', () => {
    const out: FromThread[] = [];
    const host = new PlanetHost(0, ['W00'], (m) => out.push(m), undefined, { modules: [faultModule] });
    host.handle({ t: 'load', planetId: 'pl_R', params: { type: DEV_PLANET_TYPE, seed: DEV_PLANET_SEED, radius: 8 } });
    host.handle({ t: 'cmd', planetId: 'pl_R', cmd: cmd('test.reject', 'c_r') });
    expect(host.stepPlanet('pl_R', 1)).toBe(true);
    expect(out.filter((m) => m.t === 'reject')).toEqual([
      { t: 'reject', planetId: 'pl_R', commandId: 'c_r', code: 'site_blocked', appliedAtTick: 1, detail: 'trees on 2 tiles' },
    ]);
  });
});

describe('a sim thread that dies (BE-11)', () => {
  it('answers in-flight commands thread_down, fails pending requests, reports its planets down, and can be restarted', async () => {
    const { g, pool, down, threadsDown } = await boot(1);
    const [id] = devPlanetIds(1, 1) as [string];
    await g.load(id);
    const killed = g.submit(id, cmd('test.die', 'c_die'));
    const queued = g.submit(id, cmd('dev.ping', 'c_queued'));
    expect(await killed).toEqual({ ok: false, commandId: 'c_die', code: 'thread_down' });
    expect(await queued).toEqual({ ok: false, commandId: 'c_queued', code: 'thread_down' });
    expect(down).toEqual([[id, 'thread_down']]);
    expect(threadsDown).toEqual([[0, [id]]]);
    expect(pool.live).toBe(0);
    await expect(g.fullState(id, 500)).rejects.toThrow(/not loaded/);
    expect(await g.submit(id, cmd('dev.ping', 'c_dead'))).toMatchObject({ ok: false, code: 'thread_down' });

    await pool.restart(0);
    expect(pool.live).toBe(1);
    await g.load(id);
    expect(await g.submit(id, cmd('dev.ping', 'c_back'))).toMatchObject({ ok: true });
  });

  it('refuses a second load of a planet that is loading or loaded (BE-16)', async () => {
    const { g } = await boot(1);
    const [id] = devPlanetIds(1, 1) as [string];
    const first = g.load(id);
    const joined = g.load(id); // a second generating load joins the first
    await expect(g.load(id, { snapshot: new Uint8Array([1]) })).rejects.toThrow(/already loading/);
    expect(await first).toBe(await joined);
    await expect(g.load(id)).rejects.toThrow(/already loaded/);
  });
});
