// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { makePerformance, NOW } from './dashboardFixtures';
import { click, fail, flush, makeMock, mount, ok, perfCalls, q } from './dashboardTestKit';

describe('action console', () => {
  it('stake posts the wallet-first body with asset, then refetches; KPIs update', async () => {
    const m = makeMock();
    m.post = (path, body) => {
      if (path !== '/v1/near/stake') return fail(500);
      const p = makePerformance();
      m.perf = (w) => ({ ...makePerformance({}, w), balances: { ...p.balances, activeStakedNear: '110' } });
      expect(body).toMatchObject({ accountId: 'pilot.mock', amount: '50', asset: 'stNEAR', pool: 'astro-stakers.pool.mock' }); // the host's pool, not the bundled mainnet default
      return ok({});
    };
    const root = await mount(m);
    (q(root, 'staking-console-asset') as HTMLSelectElement).value = 'stNEAR';
    click(root, 'staking-console-stake');
    await flush();
    await flush();
    expect(q(root, 'staking-kpi-total')!.textContent).toContain('120.50');
    expect(q(root, 'staking-console-status')!.textContent).toBe('50 stNEAR staked.');
  });

  it('unstake -> instant downgrade after the refetch', async () => {
    const m = makeMock();
    m.post = () => {
      const p = makePerformance();
      m.perf = (w) => ({ ...makePerformance({}, w), perks: { ...p.perks, tier: 1, tierKey: 'scout', tierName: 'Scout', nextTierMinNear: 50 }, balances: { ...p.balances, activeStakedNear: '0', unbondingNear: '60' } });
      return ok({});
    };
    const root = await mount(m);
    expect(q(root, 'staking-kpi-tier')!.textContent).toContain('Commander');
    click(root, 'staking-console-unstake');
    await flush();
    await flush();
    expect(q(root, 'staking-kpi-tier')!.textContent).toContain('Scout');
    expect(q(root, 'staking-topup-btn')!.textContent).toBe('Top Up to Tier 2');
  });

  it('invalid amounts never reach the host (neg + corner: 0, empty, negative)', async () => {
    const m = makeMock();
    const root = await mount(m);
    const input = q(root, 'staking-console-amount') as HTMLInputElement;
    for (const v of ['0', '', '-3']) {
      input.value = v;
      click(root, 'staking-console-stake');
      click(root, 'staking-console-unstake');
    }
    await flush();
    expect(m.calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    expect(q(root, 'staking-console-status')!.dataset.tone).toBe('error');
  });

});

describe('action console: notice, withdraw, profits', () => {
  it('early-exit notice <7d with live fee preview, hidden after 7 days with the 0 % line', async () => {
    const root = await mount(makeMock());
    const notice = q(root, 'staking-early-exit-notice')!;
    expect(notice.hidden).toBe(false);
    expect(notice.dataset.feeBp).toBe('25');
    expect(notice.textContent).toContain('0.25 %');
    expect(notice.textContent).toContain('0.125000 NEAR');
    const input = q(root, 'staking-console-amount') as HTMLInputElement;
    input.value = '100';
    input.dispatchEvent(new Event('input'));
    expect(notice.textContent).toContain('0.250000 NEAR');
    const p = makePerformance();
    const free = await mount(makeMock(() => ({ ...p, timers: { ...p.timers, earlyExitFeeBp: 0, earlyExitFreeAtMs: null } })));
    expect(q(free, 'staking-early-exit-notice')!.hidden).toBe(true);
    expect(q(free, 'staking-early-exit-free')!.hidden).toBe(false);
  });

  it('unbonding countdown and single-step withdraw enable only when there is something to show', async () => {
    const none = await mount(makeMock());
    expect(q(none, 'staking-unbonding-countdown')!.hidden).toBe(true);
    expect((q(none, 'staking-console-withdraw') as HTMLButtonElement).disabled).toBe(true);
    const p = makePerformance();
    const m = makeMock(() => ({ ...p, balances: { ...p.balances, unbondingNear: '5', withdrawableNear: '5' }, timers: { ...p.timers, unbondingReadyAtMs: NOW + 2 * 86_400_000 + 3_600_000 } }));
    m.post = (path) => (path === '/v1/near/withdraw' ? ok({}) : fail(500));
    const root = await mount(m);
    expect(q(root, 'staking-unbonding-countdown')!.hidden).toBe(false);
    expect(q(root, 'staking-unbonding-countdown')!.textContent).toContain('2d 1h');
    click(root, 'staking-console-withdraw');
    await flush();
    expect(m.calls.some((c) => c.url === '/v1/near/withdraw')).toBe(true);
  });

  it('stake trade profits: dry quote line on testnet, nothing marked staked', async () => {
    const m = makeMock();
    m.post = (path, body) => {
      expect(path).toBe('/v1/near/stake/profits');
      expect(body).toMatchObject({ accountId: 'pilot.testnet', amountUsdc: '10.00', dry: true, asset: 'stNEAR' });
      return ok({ quote: { amountInUsdc: '10.00', amountInAtomic: '10000000', amountOutNear: '2', nearUsd: 5, source: 'mock', dry: true }, txHash: null, position: null, walletBalanceNear: '12.5' });
    };
    const root = await mount(m, { accountId: 'pilot.testnet' });
    const before = perfCalls(m).length;
    click(root, 'staking-stake-profits-btn');
    await flush();
    expect(q(root, 'staking-profits-quote')!.textContent).toBe('10.00 USDC → 2 stNEAR @ $5.00 (mock, dry quote)');
    expect(q(root, 'staking-console-status')!.textContent).toContain('Dry quote');
    expect(perfCalls(m).length).toBe(before);
  });

  it('mock network (non-dry) profits stake refetches performance', async () => {
    const m = makeMock();
    m.post = (_p, body) => {
      expect(body.dry).toBe(false);
      return ok({ quote: { amountInUsdc: '10.00', amountInAtomic: '10000000', amountOutNear: '2', nearUsd: 5, source: 'mock', dry: false }, txHash: 'tx1', position: null, walletBalanceNear: '12.5' });
    };
    const root = await mount(m);
    const before = perfCalls(m).length;
    click(root, 'staking-stake-profits-btn');
    await flush();
    await flush();
    expect(perfCalls(m).length).toBe(before + 1);
  });
});

describe('action console: real-network wallet-tx & LST pool routing', () => {
  it('shows <7d early-exit notice on LST-only positions where activeStakedNear is 0', async () => {
    const p = makePerformance();
    const m = makeMock(() => ({
      ...p,
      balances: {
        ...p.balances,
        activeStakedNear: '0',
        lst: [{ asset: 'stNEAR', amount: '50', nearValue: '50' }],
      },
    }));
    const root = await mount(m);
    const notice = q(root, 'staking-early-exit-notice')!;
    expect(notice.hidden).toBe(false);
    expect(notice.textContent).toContain('0.125000 NEAR');
  });
});

describe('action console: real-network wallet-tx & LST pool isolation', () => {
  it('real network (testnet): routes stake, unstake, and withdraw through wallet-tx + selector and isolates LST pools from native pools', async () => {
    const signedTxs: Array<{ receiverId: string; actions: unknown[] }> = [];
    const walletTxQueries: string[] = [];
    const p = makePerformance({ accountId: 'pilot.testnet' });
    const m = makeMock(() => ({
      ...p,
      balances: { ...p.balances, activeStakedNear: '50', withdrawableNear: '5' },
    }));
    const origFetch = m.fetch;
    m.fetch = async (url, init) => {
      if (url.startsWith('/v1/near/staking/wallet-tx?')) {
        walletTxQueries.push(url);
        const u = new URL(url, 'http://x');
        return ok({
          contractId: u.searchParams.get('action') === 'stake_lst' ? (u.searchParams.get('lstContract') ?? 'meta-v2.pool.testnet') : 'staking.terraagent.testnet',
          methodName: u.searchParams.get('action') === 'stake_lst' ? 'ft_transfer_call' : u.searchParams.get('action'),
          args: { pool_id: u.searchParams.get('poolId') },
          attachedDepositYocto: '0',
          gasTgas: 50,
        });
      }
      return origFetch(url, init);
    };
    m.post = () => fail(401, { message: 'NEP-413 walletSignature is required' });
    const root = await mount(m, {
      accountId: 'pilot.testnet',
      selectorFactory: async () => ({
        wallet: async () => ({
          signAndSendTransaction: async (params) => {
            signedTxs.push(params);
            return { transaction_outcome: { id: `tx_${signedTxs.length}` } };
          },
        }),
      }),
    });

    // 1. Native NEAR stake, unstake, and withdraw all build wallet-tx descriptors and sign via wallet (zero 401 REST POSTs!)
    click(root, 'staking-console-stake');
    await flush();
    await flush();
    expect(walletTxQueries.at(-1)).toContain('action=stake_payable');
    expect(walletTxQueries.at(-1)).toContain('poolId=astro-stakers.pool.mock');

    click(root, 'staking-console-unstake');
    await flush();
    await flush();
    expect(walletTxQueries.at(-1)).toContain('action=unstake');
    expect(walletTxQueries.at(-1)).toContain('poolId=astro-stakers.pool.mock');

    click(root, 'staking-console-withdraw');
    await flush();
    await flush();
    expect(walletTxQueries.at(-1)).toContain('action=withdraw');
    expect(walletTxQueries.at(-1)).toContain('poolId=astro-stakers.pool.mock');

    // 2. Switch asset to stNEAR -> stake, unstake, withdraw pass poolId=meta-v2.pool.testnet & lstContract=meta-v2.pool.testnet!
    const select = q(root, 'staking-console-asset') as HTMLSelectElement;
    select.value = 'stNEAR';
    select.dispatchEvent(new Event('change'));

    click(root, 'staking-console-stake');
    await flush();
    await flush();
    expect(walletTxQueries.at(-1)).toContain('action=stake_lst');
    expect(walletTxQueries.at(-1)).toContain('poolId=meta-v2.pool.testnet');
    expect(walletTxQueries.at(-1)).toContain('lstContract=meta-v2.pool.testnet');

    click(root, 'staking-console-unstake');
    await flush();
    await flush();
    expect(walletTxQueries.at(-1)).toContain('action=unstake');
    expect(walletTxQueries.at(-1)).toContain('poolId=meta-v2.pool.testnet');
    expect(walletTxQueries.at(-1)).toContain('lstContract=meta-v2.pool.testnet');

    click(root, 'staking-console-withdraw');
    await flush();
    await flush();
    expect(walletTxQueries.at(-1)).toContain('action=withdraw_lst');
    expect(walletTxQueries.at(-1)).toContain('poolId=meta-v2.pool.testnet');
    expect(walletTxQueries.at(-1)).toContain('lstContract=meta-v2.pool.testnet');

    expect(signedTxs).toHaveLength(6);
    expect(m.calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });
});

