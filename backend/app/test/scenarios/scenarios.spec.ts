import type { INestApplication } from '@nestjs/common';
import { restore } from '@terra/sim';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { GamePlanets } from '../../src/game/game-planets.service';

const apps: INestApplication[] = [];
afterAll(async () => { await Promise.all(apps.map((a) => a.close())); });

async function boot(source: Record<string, string>) {
  const { app } = await createApp({ source: { SIM_THREADS: '1', NODE_ENV: 'test', ...source } });
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

  it('the dev command `scenario` and the list route work; an unknown id is a 404', async () => {
    const { url } = await boot({});
    const r = await fetch(`${url}/v1/dev/commands/scenario`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'w00-empty' }) });
    expect(((await r.json()) as { planetId: string }).planetId).toMatch(/^pl_/);
    expect(((await (await fetch(`${url}/v1/dev/scenarios`)).json()) as { scenarios: { id: string }[] }).scenarios.map((s) => s.id)).toContain('w00');
    expect((await create(url, 'nope')).status).toBe(404);
  });

  it('404s in production', async () => {
    const { url } = await boot({ NODE_ENV: 'production', NEAR_ALLOW_MOCK_IN_PROD: 'true', AI_ALLOW_MOCK_IN_PROD: 'true', NOTIFY_ALLOW_MOCK_IN_PROD: 'true' });
    expect((await create(url, 'w00')).status).toBe(404);
  });
});
