import type { INestApplication } from '@nestjs/common';
import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../../src/app';
import { defineDevCommand, DevCommandRegistry } from '../../src/dev/dev-command.registry';

const PROD = { NODE_ENV: 'production', JWT_ACCESS_SECRET: 'prod-test-jwt-secret-0123456789', NEAR_ALLOW_MOCK_IN_PROD: 'true', AI_ALLOW_MOCK_IN_PROD: 'true', NOTIFY_ALLOW_MOCK_IN_PROD: 'true' };
const echo = defineDevCommand({ name: 'test.echo', help: 'Echo n doubled', args: z.object({ n: z.number().int() }), run: ({ n }) => ({ doubled: n * 2 }) });

const apps: INestApplication[] = [];
afterAll(async () => { await Promise.all(apps.map((a) => a.close())); });

async function boot(source: Record<string, string>) {
  const { app } = await createApp({ source: { SIM_THREADS: '1', ...source } });
  await app.listen(0, '127.0.0.1');
  apps.push(app);
  const url = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  return { app, url };
}
const post = (url: string, name: string, body: unknown) =>
  fetch(`${url}/v1/dev/commands/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('dev module (development)', () => {
  it('lists registered commands (chain.ping included), runs one, rejects bad args with 400, unknown with 404', async () => {
    const { app, url } = await boot({ NODE_ENV: 'test' });
    app.get(DevCommandRegistry).register(echo);
    const list = (await (await fetch(`${url}/v1/dev/commands`)).json()) as { commands: { name: string; help: string }[] };
    expect(list.commands.map((c) => c.name)).toEqual(expect.arrayContaining(['chain.ping', 'test.echo']));
    const ok = await post(url, 'test.echo', { n: 21 });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ doubled: 42 });
    expect((await post(url, 'test.echo', { n: 'x' })).status).toBe(400);
    expect((await post(url, 'nope', {})).status).toBe(404);
  });

  it('planet.wipe (LED-06): 409 for a loaded planet, wipes an unloaded one, 400 for a bad id', async () => {
    const { url } = await boot({ NODE_ENV: 'test', GAME_DEV_PLANETS: '1' });
    const [loaded] = ((await (await fetch(`${url}/v1/dev/planets`)).json()) as { planets: { id: string }[] }).planets;
    const refused = await post(url, 'planet.wipe', { planetId: loaded!.id });
    expect([refused.status, ((await refused.json()) as { errorCode: string }).errorCode]).toEqual([409, 'PLANET_LOADED']);
    const ok = await post(url, 'planet.wipe', { planetId: 'pl_held_one' });
    expect([ok.status, await ok.json()]).toEqual([200, { planetId: 'pl_held_one', wiped: true }]);
    expect((await post(url, 'planet.wipe', { planetId: 'nope' })).status).toBe(400);
  });

  it('time: initializes from PLANET_DAY_HOURS / PLANET_TIME_SCALE, updates planet solar clock, and 404s unloaded planet', async () => {
    const { url } = await boot({ NODE_ENV: 'test', GAME_DEV_PLANETS: '1', PLANET_DAY_HOURS: '0.5', PLANET_TIME_SCALE: '2' });
    const [loaded] = ((await (await fetch(`${url}/v1/dev/planets`)).json()) as { planets: { id: string }[] }).planets;
    const initial = await post(url, 'time', { planetId: loaded!.id });
    expect(initial.status).toBe(200);
    const initialBody = (await initial.json()) as { planetId: string; realHoursPerDay: number; timeScale: number };
    expect(initialBody.planetId).toBe(loaded!.id);
    expect(initialBody.realHoursPerDay).toBeCloseTo(0.5, 4);
    expect(initialBody.timeScale).toBeCloseTo(2, 4);

    const updated = await post(url, 'time', { planetId: loaded!.id, timeOfDay: 18, realHoursPerDay: 1.5, timeScale: 3 });
    expect(updated.status).toBe(200);
    const body = (await updated.json()) as { planetId: string; realHoursPerDay: number; timeScale: number; phase: string };
    expect(body.planetId).toBe(loaded!.id);
    expect(body.realHoursPerDay).toBeCloseTo(1.5, 4);
    expect(body.timeScale).toBeCloseTo(3, 4);
    expect(body.phase).toBe('dusk');
    expect((await post(url, 'time', { planetId: 'pl_unloaded' })).status).toBe(404);
  });

  it('refuses a duplicate name', async () => {
    const { app } = await boot({ NODE_ENV: 'test' });
    const reg = app.get(DevCommandRegistry);
    reg.register(echo);
    expect(() => reg.register(echo)).toThrow(/already registered/);
  });
});

describe('dev module (production)', () => {
  it('404s every route and registers nothing', async () => {
    const { app, url } = await boot(PROD);
    const reg = app.get(DevCommandRegistry);
    reg.register(echo);
    expect(reg.enabled).toBe(false);
    expect(reg.list()).toEqual([]);
    expect((await fetch(`${url}/v1/dev/commands`)).status).toBe(404);
    expect((await post(url, 'chain.ping', {})).status).toBe(404);
    expect((await post(url, 'test.echo', { n: 1 })).status).toBe(404);
  });
});
