import type { INestApplication } from '@nestjs/common';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { JSDOM } from 'jsdom';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FeatureContext } from '../../../../frontend/game/core/registry/types.js';
import { DeedPanel } from '../../../../frontend/game/features/deed/deedPanel.js';
import { buildMockNep413Signature } from '../../../../frontend/game/features/deed/signerModal.js';
import { createApp } from '../../src/app.js';

let db: TestDatabase;
let app: INestApplication;
let url: string;
let jsdom: JSDOM;

beforeAll(async () => {
  jsdom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1/' });
  globalThis.window = jsdom.window as unknown as Window & typeof globalThis;
  globalThis.document = jsdom.window.document;

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

async function postDevCmd(name: string, args: Record<string, unknown> = {}) {
  const res = await fetch(`${url}/v1/dev/commands/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(args),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe('W20-21 StakingPanel end-to-end client <-> server HTTP integration', () => {
  it('completes settle -> claim account -> stake 10 NEAR -> warp 1 day (rewards) -> unstake -> warp 4 epochs -> withdraw', async () => {
    await postDevCmd('deed.show', {});
    await postDevCmd('stake.fund', { near: 100 });
    await postDevCmd('deed.settle', {});

    const parent = document.createElement('div');
    const ctx: FeatureContext = {
      flags: new Set(['W20']),
      host: 'server',
      services: {},
    };
    const fetchFn: typeof fetch = (input, init) => {
      const path = typeof input === 'string' ? input : input.toString();
      return fetch(path.startsWith('http') ? path : `${url}${path}`, init);
    };

    const deedPanel = new DeedPanel(parent, ctx, {
      fetchFn,
      openSigner: (req) => ({
        promise: Promise.resolve({
          status: 'approved',
          signature: buildMockNep413Signature({
            accountId: req.accountId,
            recipient: req.recipient,
            message: req.message,
          }),
        }),
        approve: () => {},
        reject: () => {},
        close: () => {},
        root: document.createElement('div'),
      }),
    });

    await deedPanel.refreshFromServer(true);
    const staking = deedPanel.stakingPanel;
    await staking.refreshFromServer();

    expect(staking.controlsWrapEl.hidden).toBe(false);
    expect(await staking.claimAccountFlow()).toBe(true);

    staking.amountInputEl.value = '10';
    expect(await staking.stakeFlow()).toBe(true);
    expect(
      staking.root.querySelector('[data-testid="staking-staked-value"]')?.textContent,
    ).toContain('10 NEAR staked');

    // Warp 1 day (86400s) -> rewards ~ 0.00246 NEAR
    await postDevCmd('time.warp', { seconds: 86_400 });
    await staking.refreshFromServer();
    const rewardsText =
      staking.root.querySelector('[data-testid="staking-rewards-value"]')?.textContent ?? '';
    expect(rewardsText).toContain('0.00246');

    // Unstake -> Unbonding (4 epochs)
    expect(await staking.unstakeFlow()).toBe(true);
    expect(staking.statusMsgEl.textContent).toContain('Unbonding');

    // Warp 4 epochs (172800s) -> Withdraw enabled
    await postDevCmd('time.warp', { seconds: 172_800 });
    await staking.refreshFromServer();
    expect(staking.withdrawBtnEl.disabled).toBe(false);

    // Withdraw -> balance returns to wallet
    expect(await staking.withdrawFlow()).toBe(true);
    const walletText =
      staking.root.querySelector('[data-testid="staking-wallet-balance"]')?.textContent ?? '';
    expect(walletText).toContain('100.00246');

    deedPanel.dispose();
  });
});
