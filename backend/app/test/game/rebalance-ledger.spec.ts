import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { getColonyStock, restore } from '@terra/sim';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { GamePlanets } from '../../src/game/game-planets.service';
import { PlanetLedgerService } from '../../src/game/ledger/planet-ledger.service';

let app: INestApplication | undefined;
afterEach(async () => { await app?.close(); app = undefined; });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('planet move with a seated colony (full app, real sim threads, in-memory journal)', () => {
  it('the journal still explains every colony stock after the planet moved threads, and no lifecycle event fired', async () => {
    const created = await createApp({ source: { NODE_ENV: 'test', SIM_THREADS: '2', JWT_ACCESS_SECRET: 'test-rebalance-ledger-jwt-secret-0123456789' } });
    app = created.app;
    await app.listen(0, '127.0.0.1');
    const url = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    const auth = await fetch(`${url}/v1/auth/guest`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceSecret: 'rebalance-ledger-device-0001', handle: 'Mover' }),
    }).then((r) => r.json() as Promise<{ accessToken: string }>);
    const home = await fetch(`${url}/v1/me/home`, { headers: { authorization: `Bearer ${auth.accessToken}` } }).then((r) => r.json() as Promise<{ state: string; planet: { id: string } }>);
    expect(home.state).toBe('ACTIVE');
    const id = home.planet.id;
    const planets = app.get(GamePlanets);
    const ledger = app.get(PlanetLedgerService);
    await ledger.settled(id);
    const seen: string[] = [];
    planets.onPlanetLoaded((p) => seen.push(`loaded:${p}`));
    planets.onPlanetUnloaded((p) => seen.push(`unloaded:${p}`));
    planets.onPlanetDown((p) => seen.push(`down:${p}`));

    const from = planets.threadOf(id);
    const moved = new Promise<number>((resolve) => planets.pool.listen((_t, m) => { if (m.t === 'moved' && m.planetId === id) resolve(m.tick); }));
    expect(planets.pool.movePlanet(id, 1 - from)).toBe(true);
    const tick = await moved;
    expect(planets.threadOf(id)).toBe(1 - from);
    await sleep(1500); // keeps stepping (and posting) on the new thread
    await ledger.settled(id);

    const full = await planets.fullState(id);
    expect(full.tick).toBeGreaterThan(tick);
    const state = restore(full.bytes);
    const stocks = Array.from({ length: state.colonies?.length ?? 0 }, (_, i) => getColonyStock(state, i));
    expect(stocks.length).toBeGreaterThan(0);
    const journal = ledger.journalOf(id)!;
    expect(journal.verify()).toEqual({ ok: true });
    expect(journal.reconcile(stocks)).toEqual([]);
    expect(seen).toEqual([]);
  }, 40_000);
});
