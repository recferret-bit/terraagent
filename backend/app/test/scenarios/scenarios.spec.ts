import type { INestApplication } from '@nestjs/common';
import { restore } from '@terra/sim';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { GamePlanets } from '../../src/game/game-planets.service';
import { UNIT_APP_ENV } from '../unit-app-env';

const apps: INestApplication[] = [];
afterAll(async () => { await Promise.all(apps.map((a) => a.close())); });

async function boot(source: Record<string, string>) {
  const { app } = await createApp({ source: { NODE_ENV: 'test', ...UNIT_APP_ENV, ...source } });
  await app.listen(0, '127.0.0.1');
  apps.push(app);
  return { app, url: (await app.getUrl()).replace('[::1]', '127.0.0.1') };
}
const create = (url: string, id: string) => fetch(`${url}/v1/dev/scenarios/${id}`, { method: 'POST' });

describe('scenario dev route', () => {
  it('two POSTs create two different planets with identical state apart from the id', async () => {
    const { app, url } = await boot({});
    const a = (await (await create(url, 'w00')).json()) as { planetId: string; scenario: string; tick: number };
    const b = (await (await create(url, 'w00')).json()) as { planetId: string; scenario: string; tick: number };
    expect(a.planetId).not.toBe(b.planetId);
    expect(a.scenario).toBe('w00');
    const planets = app.get(GamePlanets);
    expect(planets.isLoaded(a.planetId) && planets.isLoaded(b.planetId)).toBe(true);
    const sa = restore((await planets.fullState(a.planetId)).bytes);
    const sb = restore((await planets.fullState(b.planetId)).bytes);
    expect(sa.meta.planetId).toBe(a.planetId);
    expect(sa.entities.count).toBe(1);
    sa.meta.planetId = sb.meta.planetId = '';
    sa.meta.tick = sb.meta.tick = 0; // the live threads step at their own pace
    expect(sa.meta).toEqual(sb.meta);
    expect(sa.grid.count).toBe(sb.grid.count);
    expect(sa.grid.layers).toEqual(sb.grid.layers);
  });

  it('a scenario planet loaded on the server has its own worldSalt, never sent to clients (WE-07)', async () => {
    const { app, url } = await boot({});
    const planets = app.get(GamePlanets);
    const ids = await Promise.all([create(url, 'w01-landfall'), create(url, 'w01-landfall')].map(async (r) => ((await (await r).json()) as { planetId: string }).planetId));
    const salts: string[] = [];
    for (const id of ids) {
      const full = new Promise<Uint8Array>((resolve) => planets.onPlanetSnapshot((pid, snap) => { if (pid === id) resolve(snap.bytes); }));
      planets.requestSnapshot(id);
      salts.push(restore(await full).meta.worldSalt ?? '');
      expect(restore((await planets.fullState(id)).bytes).meta.worldSalt).toBeUndefined(); // the welcome strips it
    }
    expect(salts.every((s) => /^[0-9a-f-]{36}$/.test(s))).toBe(true);
    expect(salts[0]).not.toBe(salts[1]);
  });

  it('the dev command `scenario` and the list route work; an unknown id is a 404', async () => {
    const { url } = await boot({});
    const r = await fetch(`${url}/v1/dev/commands/scenario`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'w00-empty' }) });
    expect(((await r.json()) as { planetId: string }).planetId).toMatch(/^pl_/);
    expect(((await (await fetch(`${url}/v1/dev/scenarios`)).json()) as { scenarios: { id: string }[] }).scenarios.map((s) => s.id)).toContain('w00');
    expect((await create(url, 'nope')).status).toBe(404);
  });

  it('404s in production', async () => {
    const { url } = await boot({ NODE_ENV: 'production', PROGRESSION_WORKERS: 'off', JWT_ACCESS_SECRET: 'prod-test-jwt-secret-0123456789', NEAR_ALLOW_MOCK_IN_PROD: 'true', AI_ALLOW_MOCK_IN_PROD: 'true', NOTIFY_ALLOW_MOCK_IN_PROD: 'true' });
    expect((await create(url, 'w00')).status).toBe(404);
  });
});
