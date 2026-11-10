import type { INestApplication } from '@nestjs/common';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';

let db: TestDatabase;
let app: INestApplication;
let url: string;

async function postDevCommand(name: string, args: Record<string, unknown> = {}) {
  const res = await fetch(`${url}/v1/dev/commands/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(args),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

beforeAll(async () => {
  db = await createTestDatabase();
  const created = await createApp({
    source: {
      NODE_ENV: 'test',
      SIM_THREADS: '1',
      DATABASE_URL: db.url,
      NEAR_MODE: 'mock',
      TA_WAVES: 'W00,W02,W05,W06,W08,W12,W20',
    },
  });
  app = created.app;
  await app.listen(0, '127.0.0.1');
  url = (await app.getUrl()).replace('[::1]', '127.0.0.1');
});

afterAll(async () => {
  await app?.close();
  await db?.drop();
});

describe('W20-27 Dev-console commands HTTP integration', () => {
  it('executes deed.show, deed.bump, deed.settle, stake.fund, and account.claim via /v1/dev/commands/:name', async () => {
    const show1 = await postDevCommand('deed.show', {});
    expect(show1.status).toBe(200);
    expect(show1.body).toMatchObject({
      colonyId: 'col_0',
      tokenId: 'deed:col_0',
      version: 1,
      status: 'active',
      settled: false,
      terraformBp: 4000,
    });

    const bump = await postDevCommand('deed.bump', { field: 'terraform', value: 10 });
    expect(bump.status).toBe(200);
    expect(bump.body).toMatchObject({
      colonyId: 'col_0',
      change: 'Terraform 50 %',
      pendingState: 'pending',
    });

    const settle = await postDevCommand('deed.settle', {});
    expect(settle.status).toBe(200);
    expect(settle.body).toMatchObject({
      colonyId: 'col_0',
      tokenId: 'deed:col_0',
      settled: true,
    });

    const fund = await postDevCommand('stake.fund', { near: 100 });
    expect(fund.status).toBe(200);
    expect(fund.body).toMatchObject({
      walletBalanceNear: '100',
    });

    const claim = await postDevCommand('account.claim', { mock: true });
    expect(claim.status).toBe(200);
    expect(claim.body).toMatchObject({
      colonyId: 'col_0',
      claimedByAccountId: 'pilot.mock',
    });
  });

  it('supports resilience flow: near.mock.fail deed 1 + deed.bump -> retrying, then near.mock.fail deed 0 -> confirmed', async () => {
    const failOn = await postDevCommand('near.mock.fail', { port: 'deed', rate: 1 });
    expect(failOn.status).toBe(200);

    const bumpFail = await postDevCommand('deed.bump', { field: 'terraform', value: 10 });
    expect(bumpFail.status).toBe(200);
    expect(bumpFail.body).toMatchObject({
      pendingState: 'retrying',
    });
    expect(Number(bumpFail.body.retries)).toBeGreaterThanOrEqual(1);

    const failOff = await postDevCommand('near.mock.fail', { port: 'deed', rate: 0 });
    expect(failOff.status).toBe(200);

    const showAfter = await postDevCommand('deed.show', {});
    expect(showAfter.status).toBe(200);
    expect(['NONE', 'FINAL']).toContain(showAfter.body.pendingState);
    expect(showAfter.body.retries).toBe(0);
  });
});
