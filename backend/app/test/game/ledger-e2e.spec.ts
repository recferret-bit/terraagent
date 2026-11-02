import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { PlanetLedgerService } from '../../src/game/ledger/planet-ledger.service';

let app: INestApplication | undefined;
afterEach(async () => { await app?.close(); app = undefined; });

describe('server ledger end to end (real sim thread, in-memory journal)', () => {
  it('a seated colony\'s landing cargo shows up in GET /v1/dev/planets/:planetId/ledger', async () => {
    const created = await createApp({ source: { NODE_ENV: 'test', SIM_THREADS: '1', JWT_ACCESS_SECRET: 'test-ledger-e2e-jwt-secret-0123456789' } });
    app = created.app;
    await app.listen(0, '127.0.0.1');
    const url = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    const auth = await fetch(`${url}/v1/auth/guest`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceSecret: 'ledger-e2e-device-secret-0001', handle: 'Ledger' }),
    }).then((r) => r.json() as Promise<{ accessToken: string }>);
    const home = await fetch(`${url}/v1/me/home`, { headers: { authorization: `Bearer ${auth.accessToken}` } }).then((r) => r.json() as Promise<{ state: string; planet: { id: string } }>);
    expect(home.state).toBe('ACTIVE');
    await app.get(PlanetLedgerService).settled(home.planet.id);

    const res = await fetch(`${url}/v1/dev/planets/${home.planet.id}/ledger?account=colony:0&limit=10`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { planetId: string; account: string; balances: Record<string, number>; entries: Array<{ seq: number; at: number; reason: string; legs: unknown[] }> };
    expect(body.planetId).toBe(home.planet.id);
    expect(body.account).toBe('colony:0');
    expect(body.balances['metals.t1']).toBeGreaterThan(0);
    expect(body.entries.length).toBeGreaterThan(0);
    expect(body.entries.every((e) => e.at > 0 && e.legs.length >= 2)).toBe(true);
    expect(app.get(PlanetLedgerService).journalOf(home.planet.id)!.verify()).toEqual({ ok: true });
    expect((await fetch(`${url}/v1/dev/planets/pl_nope/ledger`)).status).toBe(404);
  }, 20_000);
});
