import 'reflect-metadata';
import { MAX_CATCHUP } from '@terra/sim';
import { afterEach, describe, expect, it } from 'vitest';
import { devPlanetIds } from '../../src/game/dev-planets';
import { GamePlanets } from '../../src/game/game-planets.service';
import { SimThreadPool } from '../../src/game/sim-thread-pool';

let games: GamePlanets | undefined;
afterEach(async () => { await games?.shutdown(); games = undefined; });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('scheduler lag on a real sim thread', () => {
  it('2 s block: at most 5 catch-up steps per pass, lag rises then returns to 0', async () => {
    const pool = new SimThreadPool({ threads: 1, flags: ['W00'] });
    await pool.start();
    games = new GamePlanets(pool);
    const id = devPlanetIds(1, 1)[0]!;
    await games.load(id);
    await sleep(500);
    expect((await pool.stats())[0]!.maxLag).toBe(0);

    pool.send(0, { t: 'ctl', op: 'block', ms: 2000 });
    const series: number[] = [];
    const t0 = Date.now();
    // queued behind the block: answered as soon as it ends
    series.push((await pool.stats(5000))[0]!.maxLag);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1500);
    for (let i = 0; i < 12; i++) { await sleep(150); series.push((await pool.stats())[0]!.maxLag); }
    const final = (await pool.stats())[0]!;
    console.log('lag series (per stats sample):', series.join(','));
    console.log('pass lag series:', final.recentPasses.map((p) => p.maxLag).join(','));
    console.log('steps per pass:', final.recentPasses.map((p) => p.steps).join(','));

    const passes = final.recentPasses;
    expect(Math.max(...passes.map((p) => p.maxPlanetSteps))).toBeLessThanOrEqual(MAX_CATCHUP);
    expect(Math.max(...passes.map((p) => p.maxLag))).toBeGreaterThanOrEqual(4); // rose
    expect(final.maxLag).toBe(0); // fell back
    expect(final.planets[0]!.lagSteps).toBe(0);
  }, 12_000);
});
