import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { compileData } from '@terra/sim';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { devPlanetIds } from '../../src/game/dev-planets';

const apps: INestApplication[] = [];
afterAll(async () => { await Promise.all(apps.map((a) => a.close())); });

const file = (text: string) => {
  const f = join(mkdtempSync(join(tmpdir(), 'bal-')), 'balance.overrides.json');
  writeFileSync(f, text);
  return f;
};
async function boot(source: Record<string, string>) {
  const { app } = await createApp({ source: { NODE_ENV: 'test', SIM_THREADS: '1', GAME_DEV_PLANETS: '1', ...source } });
  await app.listen(0, '127.0.0.1');
  apps.push(app);
  return (await app.getUrl()).replace('[::1]', '127.0.0.1');
}
const tune = (url: string, body: unknown) =>
  fetch(`${url}/v1/dev/commands/tune`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const [PLANET] = devPlanetIds(1, 1);

describe('dev command tune', () => {
  it('sets, exports and resets over HTTP; validates args and paths', async () => {
    const url = await boot({});
    const base = compileData(new Set(['W00'])).hash;
    const set = await (await tune(url, { planetId: PLANET, op: 'set', path: 'dev.probe.nudgeTiles', value: 3 })).json() as { dataHash: string };
    expect(set.dataHash).not.toBe(base);
    const exp = await (await tune(url, { planetId: PLANET, op: 'export' })).json() as { text: string };
    expect(JSON.parse(exp.text)).toEqual({ dev: { probe: { nudgeTiles: 3 } } });
    expect(((await (await tune(url, { planetId: PLANET, op: 'reset' })).json()) as { dataHash: string }).dataHash).toBe(base);
    expect((await tune(url, { planetId: PLANET, op: 'set', path: 'dev.probe.typo', value: 1 })).status).toBe(400);
    expect((await tune(url, { planetId: PLANET, op: 'set' })).status).toBe(400);
    expect((await tune(url, { planetId: 'pl_missing', op: 'export' })).status).toBe(404);
  });

  it('TA_BALANCE_OVERRIDES is applied at boot; a bad file is a boot error naming it', async () => {
    const f = file('{"dev":{"probe":{"nudgeTiles":2}}}');
    const url = await boot({ TA_BALANCE_OVERRIDES: f });
    const r = await (await tune(url, { planetId: PLANET, op: 'export' })).json() as { text: string; dataHash: string };
    expect(JSON.parse(r.text)).toEqual({ dev: { probe: { nudgeTiles: 2 } } });
    expect(r.dataHash).toBe(compileData(new Set(['W00']), { dev: { probe: { nudgeTiles: 2 } } }).hash);
    const bad = file('{"dev":{"probe":{"typo":2}}}');
    await expect(createApp({ source: { NODE_ENV: 'test', SIM_THREADS: '1', TA_BALANCE_OVERRIDES: bad } })).rejects.toThrow(bad);
  });
});
