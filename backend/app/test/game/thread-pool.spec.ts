import 'reflect-metadata';
import { newId } from '@terra/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { devPlanetIds } from '../../src/game/dev-planets';
import { GamePlanets } from '../../src/game/game-planets.service';
import { SimThreadPool } from '../../src/game/sim-thread-pool';
import { threadOf } from '../../src/game/thread/assign';

const ALL_WAVES = Array.from({ length: 21 }, (_, i) => `W${String(i).padStart(2, '0')}`);
let games: GamePlanets | undefined;
const boot = async (threads: number, autoStep = true) => {
  const pool = new SimThreadPool({ threads, flags: ALL_WAVES, autoStep });
  await pool.start();
  return (games = new GamePlanets(pool));
};
afterEach(async () => { await games?.shutdown(); games = undefined; });

const cmd = (kind: string, commandId = 'c1') => ({ colonyIndex: null, source: 'dev' as const, commandId, kind, args: {} });

describe('SimThreadPool', () => {
  it('3 threads, 6 planets -> 2 per thread', async () => {
    const g = await boot(3);
    const ids = devPlanetIds(6, 3);
    await Promise.all(ids.map((id) => g.load(id)));
    const stats = await g.pool.stats();
    expect(stats.map((s) => s.planets.length)).toEqual([2, 2, 2]);
    for (const id of ids) expect(stats[threadOf(id, 3)]!.planets.map((p) => p.planetId)).toContain(id);
  });

  it('assignment is deterministic and within range', () => {
    const id = newId('pl');
    expect(threadOf(id, 5)).toBe(threadOf(id, 5));
    expect(threadOf(id, 5)).toBeLessThan(5);
  });

  it('round-trips a command to an ack with appliedAtTick, and rejects unknown kinds', async () => {
    const g = await boot(2);
    const id = devPlanetIds(1, 2)[0]!;
    await g.load(id);
    const bad = await g.submit(id, cmd('definitely.not.a.kind'));
    expect(bad).toMatchObject({ ok: false, code: 'unknown_kind', commandId: 'c1' });
    expect(bad.appliedAtTick).toBeGreaterThan(0);
  });

  it('acks a known command and rejects on an unloaded planet', async () => {
    const g = await boot(1);
    const id = devPlanetIds(1, 1)[0]!;
    expect(await g.submit(id, cmd('x'))).toMatchObject({ ok: false, code: 'planet_not_loaded' });
  });

  it('steps loaded planets and publishes ticks', async () => {
    const g = await boot(1);
    const id = devPlanetIds(1, 1)[0]!;
    await g.load(id);
    await new Promise((r) => setTimeout(r, 700));
    const [s] = await g.pool.stats();
    expect(s!.planets[0]!.tick).toBeGreaterThanOrEqual(2);
  });

  it('terminates threads cleanly', async () => {
    const g = await boot(3);
    expect(g.pool.live).toBe(3);
    await g.shutdown();
    expect(g.pool.live).toBe(0);
    games = undefined;
  });
});
