// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CANONICAL_PLANETS, STAKING_TIERS } from '@terra/contracts';
import { renderStakingSection } from './StakingSection';
import { makePerformance, NOW } from './dashboard/dashboardFixtures';

function createStatefulStakingServer() {
  const st = { activeNear: 50, accruedNear: 1.5, unbondingNear: 0, withdrawableNear: 0, windowReq: '30d' as '30d' | '90d' | '1y' };
  const buildPerf = (w: '30d' | '90d' | '1y') => {
    st.windowReq = w;
    const base = makePerformance({}, w);
    return {
      ...base,
      balances: { ...base.balances, walletNear: '40', activeStakedNear: String(st.activeNear), unbondingNear: String(st.unbondingNear), withdrawableNear: String(st.withdrawableNear), accruedYieldNear: String(st.accruedNear), totalStakedUsd: st.activeNear * 5 },
      perks: { ...base.perks, totalStakedNear: String(st.activeNear), activeStakedNear: String(st.activeNear) },
    };
  };
  const doFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.includes('/v1/near/staking/overview')) {
      return new Response(JSON.stringify({
        asOfMs: NOW, network: 'mock', price: { nearUsd: 5, source: 'live', asOfMs: NOW }, apy: { grossApyBp: 900, netApyBp: 720, protocolYieldShareBp: 2000, source: 'sim' },
        tiers: [...STAKING_TIERS], rules: { feeWarmupMs: 86_400_000, earlyExitWindowMs: 604_800_000, earlyExitFeeBp: 25, freeTrialTurns: 5, standardTakerFeeBp: 100 },
        projection: { amountNear: 50, dailyNear: 0.01, monthlyNear: 0.3, yearlyNear: 3.6, dailyUsd: 0.05, monthlyUsd: 1.5, yearlyUsd: 18 },
        ecosystem: { totalNear: String(st.activeNear), entries: [] },
      }), { status: 200 });
    }
    if (url.includes('/v1/near/staking/performance')) {
      return new Response(JSON.stringify(buildPerf((new URL(url, 'http://x').searchParams.get('window') ?? '30d') as '30d' | '90d' | '1y')), { status: 200 });
    }
    if (method === 'GET' && /\/v1\/near\/staking\?/.test(url)) {
      return new Response(JSON.stringify({ positions: [], pools: [{ poolId: 'astro-stakers.pool.mock' }] }), { status: 200 });
    }
    const body = init?.body ? (JSON.parse(String(init.body)) as { amount?: string }) : {};
    if (url.includes('/v1/near/stake/compound')) { st.activeNear += st.accruedNear; st.accruedNear = 0; return new Response(JSON.stringify({ ok: true }), { status: 200 }); }
    if (url.includes('/v1/near/stake')) { st.activeNear += Number(body.amount ?? 0); return new Response(JSON.stringify({ ok: true }), { status: 200 }); }
    if (url.includes('/v1/near/unstake')) { const amt = Number(body.amount ?? 0); st.activeNear -= amt; st.unbondingNear += amt; st.withdrawableNear += amt; return new Response(JSON.stringify({ ok: true }), { status: 200 }); }
    if (url.includes('/v1/near/withdraw')) { st.withdrawableNear = 0; st.unbondingNear = 0; return new Response(JSON.stringify({ ok: true }), { status: 200 }); }
    return new Response('{}', { status: 404 });
  });
  return { st, doFetch };
}

describe('/me.html#staking signed-out preview integration (jsdom)', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('renders signed-out projection preview and updates ecosystem on signed-out overview load', async () => {
    const doFetch = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes('/v1/near/staking/overview')
        ? new Response(JSON.stringify({
            asOfMs: NOW, network: 'mock', price: { nearUsd: 5, source: 'live', asOfMs: NOW }, apy: { grossApyBp: 900, netApyBp: 720, protocolYieldShareBp: 2000, source: 'live' },
            tiers: [...STAKING_TIERS], rules: { feeWarmupMs: 86_400_000, earlyExitWindowMs: 604_800_000, earlyExitFeeBp: 25, freeTrialTurns: 5, standardTakerFeeBp: 100 },
            projection: { amountNear: 100, dailyNear: 0.019, monthlyNear: 0.6, yearlyNear: 7.2, dailyUsd: 0.098, monthlyUsd: 3, yearlyUsd: 36 },
            ecosystem: { totalNear: '2500', entries: [{ id: 'validator', asset: 'near', label: 'Validators', tvlNear: '2500', sharePct: 100 }] },
          }), { status: 200 })
        : new Response('{}', { status: 404 }),
    );
    const handle = renderStakingSection({ amount: 100, connected: false, fetch: doFetch as unknown as typeof fetch, onConnect: vi.fn() });
    document.body.append(handle.el);
    await handle.ready;
    expect(handle.el.querySelector('[data-testid="staking-dashboard"]')).toBeNull();
    expect(handle.el.querySelector('[data-testid="staking-ecosystem-total"]')?.textContent).toContain('2,500 NEAR');
  });
});

describe('/me.html#staking signed-in Wealth Dashboard integration (jsdom)', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('runs stake -> compound -> unstake -> withdraw -> window switch -> planet tab switch against stateful API', async () => {
    const { st, doFetch } = createStatefulStakingServer();
    const onStakingChange = vi.fn();
    const handle = renderStakingSection({ amount: 50, connected: true, accountId: 'pilot.mock', search: '?as=w12', fetch: doFetch as unknown as typeof fetch, onConnect: vi.fn(), onStakingChange });
    document.body.append(handle.el);
    await handle.ready;

    const amtInput = handle.el.querySelector<HTMLInputElement>('[data-testid="staking-console-amount"]')!;
    amtInput.value = '25';
    handle.el.querySelector<HTMLButtonElement>('[data-testid="staking-console-stake"]')?.click();
    await vi.waitFor(() => expect(handle.el.querySelector('[data-testid="staking-kpi-total"]')?.textContent).toContain('75.00'));

    handle.el.querySelector<HTMLButtonElement>('[data-testid="staking-console-compound"]')?.click();
    await vi.waitFor(() => expect(handle.el.querySelector('[data-testid="staking-kpi-total"]')?.textContent).toContain('76.50'));

    amtInput.value = '10';
    handle.el.querySelector<HTMLButtonElement>('[data-testid="staking-console-unstake"]')?.click();
    await vi.waitFor(() => expect(handle.el.querySelector('[data-testid="staking-kpi-total"]')?.textContent).toContain('66.50'));

    handle.el.querySelector<HTMLButtonElement>('[data-testid="staking-console-withdraw"]')?.click();
    await vi.waitFor(() => expect(st.withdrawableNear).toBe(0));

    handle.el.querySelector<HTMLButtonElement>('[data-testid="staking-chart-window-90d"]')?.click();
    await vi.waitFor(() => expect(st.windowReq).toBe('90d'));

    handle.el.querySelector<HTMLButtonElement>('[data-testid="staking-planet-chip-ocean"]')?.click();
    expect(handle.el.querySelector('[data-testid="staking-patron-competition-title"]')?.textContent).toContain('THALASSA VERDE');
    expect(handle.el.querySelector('[data-testid="staking-income-yield-usd"]')?.textContent).toBe('$5.00');
    expect(handle.el.querySelector('[data-testid="staking-income-fees-usd"]')?.textContent).toBe('$2.00');
    expect(onStakingChange).toHaveBeenCalled();
    expect(CANONICAL_PLANETS.ocean.id).toBeTruthy();
  });
});
