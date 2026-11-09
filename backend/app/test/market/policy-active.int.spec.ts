import type { INestApplication } from '@nestjs/common';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import seed from '../../../../shared/db/seeds/0002_economy_baseline';
import { createApp } from '../../src/app';
import { EventBus } from '../../src/bus/event-bus';
import { DEV_ECONOMY_ACTIVATE_TOKEN, DEV_ECONOMY_EDIT_TOKEN } from '../../src/economy/economy-auth';
import { MarketSnapshotService } from '../../src/market/api/market-snapshot.service';
import { MarketPolicyProvider } from '../../src/market/orders/market-policy.provider';

/** W13-35: the active economy profile drives the market policy new orders pin; `market.setHubFee` is persisted. */
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let db: TestDatabase;
let app: INestApplication;
let url: string;
const call = async (method: string, path: string, body?: unknown, token = DEV_ECONOMY_ACTIVATE_TOKEN) => {
  const res = await fetch(`${url}/v1/economy${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: res.status, json: (await res.json()) as Json };
};
async function waitFor<T>(fn: () => Promise<T | false | undefined> | T | false | undefined, ms = 20_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 100));
  }
}
const active = async () => (await call('GET', '/activations?scope=global')).json.activations.find((a: Json) => a.state === 'ACTIVE') as Json;

beforeAll(async () => {
  db = await createTestDatabase();
  await seed({ prisma: db.prisma, log: () => undefined });
  ({ app } = await createApp({ source: { NODE_ENV: 'test', LOG_LEVEL: 'silent', SIM_THREADS: '1', SNAPSHOTS: 'on', DATABASE_URL: db.url, OUTBOX_RELAY_ENABLED: 'false' } }));
  await app.listen(0, '127.0.0.1');
  url = (await app.getUrl()).replace('[::1]', '127.0.0.1');
}, 120_000);
afterAll(async () => { await app?.close(); await db?.drop(); });

describe('MarketPolicyProvider follows the active profile', () => {
  it('activation changes the pinned policy and the platform fee in the snapshot; rollback restores it', async () => {
    const policy = app.get(MarketPolicyProvider);
    await waitFor(() => policy.current().platformFeeBp === 100 || undefined);
    const old = { ...policy.current() };
    const c = await call('POST', '/profiles/baseline/versions/1/clone', { requestId: 'pa-clone' }, DEV_ECONOMY_EDIT_TOKEN);
    const v = c.json.version.version.version as number;
    expect((await call('PATCH', `/profiles/baseline/versions/${v}`, { schemaVersion: 1, requestId: 'pa-patch', expectedVersion: 1, ops: [{ op: 'set', path: 'market.policy.platformFeeBp', value: 80 }] }, DEV_ECONOMY_EDIT_TOKEN)).status).toBe(200);
    expect((await call('POST', `/profiles/baseline/versions/${v}/validate`, { requestId: 'pa-val' }, DEV_ECONOMY_EDIT_TOKEN)).json.valid).toBe(true);
    expect((await call('POST', `/profiles/baseline/versions/${v}/approve`, { requestId: 'pa-appr' })).status).toBe(200);
    const prev = await active();
    expect((await call('POST', '/activations', { requestId: 'pa-act', versionId: `baseline@${v}`, expectedPreviousVersionId: prev.versionId, nonProduction: true, effectiveTick: 0 })).status).toBe(202);

    await waitFor(() => policy.current().platformFeeBp === 80 || undefined);
    expect(policy.current().policyHash).not.toBe(old.policyHash);
    expect(app.get(MarketSnapshotService).policyView()).toMatchObject({ platformFeeBp: 80, policyHash: policy.current().policyHash });

    const now = await active();
    expect((await call('POST', `/activations/${now.id}/rollback`, { requestId: 'pa-rb', effectiveTick: 0 })).status).toBe(202);
    await waitFor(() => policy.current().platformFeeBp === 100 || undefined);
    expect(policy.current().policyHash).toBe(old.policyHash);
  }, 120_000);
});

describe('market.setHubFee is persisted', () => {
  it('marketHubFeeSet upserts market_stall and the snapshot stall.hubFeeBp reads it (default without a row)', async () => {
    const snap = app.get(MarketSnapshotService);
    const caller = { playerId: 'p', colony: { colonyId: 'col_hf', accountId: 'col_hf.terraagent.mock' } };
    expect((await snap.snapshot('p_hf', caller)).stall?.hubFeeBp).toBe(100);
    app.get(EventBus).emit('planet.event', {
      planetId: 'p_hf', tick: 5, kind: 'marketHubFeeSet', severity: 'info', colonyIds: ['col_hf'],
      data: { colonyId: 'col_hf', colonyIndex: 0, hubEntityId: 7, bp: 250, previousBp: 100 },
    } as never);
    const row = await waitFor(() => db.prisma.marketStall.findUnique({ where: { planetId_colonyId: { planetId: 'p_hf', colonyId: 'col_hf' } } }).then((r) => r ?? undefined));
    expect(row).toMatchObject({ feeBp: 250, hubEntityId: 7, colonyIndex: 0 });
    expect((await snap.snapshot('p_hf', caller)).stall?.hubFeeBp).toBe(250);
  }, 60_000);
});
