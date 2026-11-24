import { describe, expect, it } from 'vitest';
import { nodeLoadScore } from '../../src/game/placement/node-load';
import { PlacementTable, UNMEASURED_PLANET_LOAD } from '../../src/game/placement/placement-table';
import { Rebalancer } from '../../src/game/placement/rebalancer';
import type { PlanetStats, ToThread } from '../../src/game/thread/protocol';

const load = (planetId: string, extra: Partial<Extract<ToThread, { t: 'load' }>> = {}): ToThread => ({ t: 'load', planetId, ...extra });
const stat = (planetId: string, loadMsPerSec: number): PlanetStats => ({
  planetId, tick: 0, entities: 0, pendingCmds: 0, subscribed: false, deltaMs: 0, deltaBytes: 0, lagSteps: 0, mode: 'active',
  nextDueMs: 0, stepsLastPass: 0, warp: 1, warpRequested: 1, lastStepMs: 0, avgStepMs: 0, loadMsPerSec, droppedSlots: 0, demoted: false,
});
/** Places `ids` and reports their measured loads twice (so the estimate gives way to the measurement). */
function measured(table: PlacementTable, loads: Record<string, [thread: number, ms: number]>) {
  for (const [id, [thread]] of Object.entries(loads)) table.placeAt(thread, load(id) as Extract<ToThread, { t: 'load' }>);
  for (let t = 0; t < table.threads; t++) {
    const on = Object.entries(loads).filter(([, [th]]) => th === t).map(([id, [, ms]]) => stat(id, ms));
    table.observe(t, on);
    table.observe(t, on);
  }
}

describe('placement table (3.1)', () => {
  it('a burst of new planets spreads evenly while nothing is measured', () => {
    const table = new PlacementTable(3);
    const threads = Array.from({ length: 6 }, (_, i) => table.route(`p${i}`, load(`p${i}`)));
    expect(threads.sort()).toEqual([0, 0, 1, 1, 2, 2]);
    expect(table.loadOf('p0')).toBe(UNMEASURED_PLANET_LOAD);
  });

  it('a new or restored planet goes to the thread with the lowest measured load', () => {
    const table = new PlacementTable(3);
    measured(table, { a: [0, 900], b: [1, 50], c: [1, 40], d: [2, 300] });
    expect(table.route('new', load('new'))).toBe(1); // 90 ms/s beats 300 and 900, despite two planets
    expect(table.threadOf('new')).toBe(1);
  });

  it('routes every message of a placed planet to its thread and records what a move must replay', () => {
    const table = new PlacementTable(2);
    const t = table.route('p', load('p', { flags: ['W00'] }));
    expect(table.route('p', { t: 'subscribe', planetId: 'p' })).toBe(t);
    table.route('p', { t: 'ctl', op: 'mode', planetId: 'p', mode: 'coarse' });
    table.route('p', { t: 'ctl', op: 'warp', planetId: 'p', k: 7 });
    expect(table.get('p')).toMatchObject({ thread: t, subscribed: true, mode: 'coarse', warp: 7, flags: ['W00'], confirmed: false });
    table.afterMessage(t, { t: 'loaded', planetId: 'p', tick: 3 });
    expect(table.get('p')!.confirmed).toBe(true);
  });

  it('a message for a planet that is not placed pins nothing', () => {
    const table = new PlacementTable(2);
    table.route('ghost', { t: 'cmd', planetId: 'ghost', cmd: { colonyIndex: null, source: 'dev', commandId: 'c', kind: 'x', args: {} } });
    expect(table.get('ghost')).toBeUndefined();
  });

  it('frees a planet that was unloaded, failed, or never loaded; and every planet of a dead thread', () => {
    const table = new PlacementTable(2);
    for (const id of ['u', 'f', 'e', 'x']) table.placeAt(0, load(id) as Extract<ToThread, { t: 'load' }>);
    table.afterMessage(0, { t: 'loaded', planetId: 'u', tick: 0 });
    table.afterMessage(0, { t: 'unloaded', planetId: 'u' });
    table.afterMessage(0, { t: 'planetFailed', planetId: 'f', message: 'boom' });
    table.afterMessage(0, { t: 'error', thread: 0, planetId: 'e', message: 'bad load' });
    expect(table.planetsOn(0)).toEqual(['x']);
    table.releaseThread(0);
    expect(table.planetsOn(0)).toEqual([]);
  });

  it('never places on a dead thread', () => {
    const table = new PlacementTable(3, (t) => t !== 0);
    expect(table.route('p', load('p'))).not.toBe(0);
  });
});

describe('rebalancer (3.2)', () => {
  const opts = { sustainMs: 60_000, cooldownMs: 60_000 };

  it('moves nothing until a thread stayed above 70% busy for 60 s', () => {
    const table = new PlacementTable(2);
    measured(table, { a: [0, 400], b: [0, 400] });
    const r = new Rebalancer(table, opts);
    r.observe(0, 0.8, 0);
    expect(r.decide(59_000, [0, 1], () => true)).toBeUndefined();
    r.observe(0, 0.6, 59_500); // dipped: the clock starts over
    r.observe(0, 0.8, 60_000);
    expect(r.decide(100_000, [0, 1], () => true)).toBeUndefined();
    expect(r.decide(120_000, [0, 1], () => true)).toEqual({ planetId: expect.any(String), from: 0, to: 1 });
  });

  it('moves the neighbours of a hog, not the hog, to the least loaded thread', () => {
    const table = new PlacementTable(3);
    measured(table, { hog: [0, 900], n1: [0, 40], n2: [0, 30], other: [1, 500] }); // the hog would make any thread hot
    const r = new Rebalancer(table, { ...opts, cooldownMs: 0 });
    r.observe(0, 0.97, 0);
    const first = r.decide(60_000, [0, 1, 2], () => true)!;
    expect(first).toMatchObject({ from: 0, to: 2 });
    expect(['n1', 'n2']).toContain(first.planetId);
  });

  it('does not move a planet alone on its thread, nor one that is not movable', () => {
    const table = new PlacementTable(2);
    measured(table, { solo: [0, 990] });
    const r = new Rebalancer(table, opts);
    r.observe(0, 0.99, 0);
    expect(r.decide(60_000, [0, 1], () => true)).toBeUndefined();
    measured(table, { mate: [0, 100] });
    expect(r.decide(60_000, [0, 1], (id) => id !== 'mate')).toBeUndefined();
    expect(r.decide(60_000, [0, 1], () => true)).toMatchObject({ planetId: 'mate', to: 1 });
  });

  it('prefers a planet nobody watches and keeps a cooldown between moves', () => {
    const table = new PlacementTable(2);
    measured(table, { watched: [0, 300], quiet: [0, 250], big: [0, 300] });
    table.route('watched', { t: 'subscribe', planetId: 'watched' });
    const r = new Rebalancer(table, opts);
    r.observe(0, 0.85, 0);
    const move = r.decide(60_000, [0, 1], () => true)!;
    expect(move.planetId).not.toBe('watched');
    r.observe(0, 0.85, 60_001);
    expect(r.decide(100_000, [0, 1], () => true)).toBeUndefined(); // still in the cooldown of the first move
    expect(r.decide(125_000, [0, 1], () => true)).toBeDefined();
  });
});

describe('cluster load score (3.3)', () => {
  it('orders by busy share first, planet count second, and matches the old count when nothing is measured', () => {
    expect(nodeLoadScore([], 4)).toBe(4);
    expect(nodeLoadScore([{ busyRatio: 0 }, { busyRatio: 0 }], 4)).toBe(4);
    const busyFew = nodeLoadScore([{ busyRatio: 0.9 }, { busyRatio: 0.5 }], 2);
    const idleMany = nodeLoadScore([{ busyRatio: 0.1 }, { busyRatio: 0.1 }], 9);
    expect(idleMany).toBeLessThan(busyFew);
    expect(busyFew).toBe(700 * 1000 + 2);
    expect(nodeLoadScore([{ busyRatio: 2 }], 5000)).toBe(1000 * 1000 + 999);
  });
});
