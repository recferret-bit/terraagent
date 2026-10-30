import type { INestApplication } from '@nestjs/common';
import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../../src/app';
import { defineDevCommand, DevCommandRegistry } from '../../src/dev/dev-command.registry';

const PROD = { NODE_ENV: 'production', NEAR_ALLOW_MOCK_IN_PROD: 'true', AI_ALLOW_MOCK_IN_PROD: 'true', NOTIFY_ALLOW_MOCK_IN_PROD: 'true' };
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
