// @vitest-environment jsdom
import { CANONICAL_PLANETS } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import { makePerformance, NOW } from './dashboardFixtures';
import { click, fail, flush, makeMock, mount, ok, perfCalls, q } from './dashboardTestKit';

describe('Wealth Dashboard render', () => {
  it('renders the 6 KPI cards, AI budget, chart, patron card, console and tx table', async () => {
    const root = await mount(makeMock());
    expect(root.dataset.testid).toBe('staking-dashboard');
    for (const id of ['staking-kpi-total', 'staking-kpi-yield', 'staking-kpi-apy', 'staking-kpi-income', 'staking-kpi-effective', 'staking-kpi-tier', 'staking-ai-budget', 'staking-slot-bar', 'staking-chart', 'staking-patron-card', 'staking-share-x', 'staking-share-social', 'staking-console-asset', 'staking-console-amount', 'staking-console-stake', 'staking-console-unstake', 'staking-console-withdraw', 'staking-stake-profits-btn', 'staking-tx-table']) {
      expect(q(root, id), id).not.toBeNull();
    }
    expect(q(root, 'staking-kpi-total')!.textContent).toContain('70.50');
    expect(q(root, 'staking-kpi-total')!.textContent).toContain('$352.50');
    expect(q(root, 'staking-price-source')!.textContent).toBe('Live');
    expect(q(root, 'staking-exit-chip')!.textContent).toContain('<7d');
    expect(q(root, 'staking-kpi-apy')!.textContent).toContain('7.20%');
    expect(q(root, 'staking-kpi-apy')!.textContent).toContain('9.00%');
    expect(q(root, 'staking-kpi-apy')!.textContent).toContain('20.00%');
    expect(q(root, 'staking-apy-source')!.textContent).toBe('Sim APY');
    expect(q(root, 'staking-kpi-income')!.textContent).toContain('NEAR');
    expect(q(root, 'staking-kpi-effective')!.textContent).toContain('8.10%');
    expect(q(root, 'staking-self-fills')!.textContent).toBe('3 self-fills excluded');
    expect(q(root, 'staking-effective-tooltip')!.title).toContain('Effective APY =');
    expect(q(root, 'staking-kpi-tier')!.textContent).toContain('Commander');
    expect(q(root, 'staking-kpi-tier')!.textContent).toContain('1 / 3');
    expect((q(root, 'staking-console-amount') as HTMLInputElement).value).toBe('50');
    expect(root.querySelectorAll('[data-testid="staking-tx-row"]').length).toBe(2);

    // Standalone Planetary Patronage block outside Top-Up card, uniform 4-zone KPI cards, and AI Compute Budget ordered properly
    expect(q(root, 'staking-topup-block')!.contains(q(root, 'staking-patron-card'))).toBe(false);
    expect(q(root, 'staking-patron-card')!.contains(q(root, 'staking-share-x'))).toBe(true);
    expect(q(root, 'staking-nominate-planet')).toBeNull();
    expect(q(root, 'staking-nominate-btn')).toBeNull();
    const bodyChildren = [...root.querySelector('.ta-stk-dash-body')!.children];
    const indexOf = (id: string) => bodyChildren.findIndex((c) => c === q(root, id) || c.contains(q(root, id)));
    expect(indexOf('staking-topup-block')).toBe(0);
    expect(indexOf('staking-patron-card')).toBe(1);
    expect(indexOf('staking-kpi-block')).toBe(2);
    expect(indexOf('staking-console')).toBe(3);
    expect(indexOf('staking-chart')).toBe(4);
    expect(indexOf('staking-tx-block')).toBe(5);
    expect(indexOf('staking-ai-budget')).toBe(6);
    const kpis = root.querySelectorAll('.ta-stk-kpi');
    expect(kpis.length).toBe(4);
    for (const kpi of kpis) {
      expect(kpi.querySelector('.ta-stk-kpi-head')).not.toBeNull();
      expect(kpi.querySelector('.ta-stk-kpi-hero')).not.toBeNull();
      expect(kpi.querySelector('.ta-stk-kpi-details')).not.toBeNull();
      expect(kpi.querySelector('.ta-stk-kpi-foot')).not.toBeNull();
    }
    expect(q(root, 'staking-kpi-block')!.contains(q(root, 'staking-kpi-income'))).toBe(true);
    expect(q(root, 'staking-income-basis')!.textContent).toContain('ACTIVE STAKE · 70.50 NEAR');
    expect(q(root, 'staking-patron-eligibility')!.textContent).toContain('LOCKED');
    expect(q(root, 'staking-patron-card')!.textContent).toContain('KING-OF-THE-HILL');

    // Simulating a custom amount inside PORTFOLIO METRICS updates Projected Income live
    q(root, 'staking-preset-500')!.click();
    expect(q(root, 'staking-income-basis')!.textContent).toContain('PREVIEW · 500.00 NEAR');
    expect(q(root, 'staking-income-yearly')!.textContent).toContain('36.00 NEAR');
  });

  it('hovering Patronage ? opens full 5-tier popup, clicking pins it, and interacting with Patron controls does not prefill Top-Up', async () => {
    const root = await mount(makeMock());
    const tipBtn = q(root, 'help-tip-btn-staking-patronage')!;
    const tipPanel = q(root, 'help-tip-panel-staking-patronage')!;
    expect(tipPanel.hidden).toBe(true);

    tipBtn.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    expect(tipPanel.hidden).toBe(false);
    expect(q(tipPanel, 'staking-active-tier-matrix')!.dataset.reachedTier).toBe('2');
    expect(tipPanel.querySelectorAll('[data-testid^="staking-active-tier-row-"]').length).toBe(5);
    expect(tipPanel.textContent).toContain('Zero Pay-to-Win');

    // Clicking after hover pins the popup instead of snapping it shut
    tipBtn.click();
    expect(tipPanel.hidden).toBe(false);

    // Selecting canonical planet tabs inside Patron block switches tabpanel without overwriting console amount
    (q(root, 'staking-console-amount') as HTMLInputElement).value = '77';
    q(root, 'staking-planet-chip-ocean')!.click();
    expect(q(root, 'staking-planet-chip-ocean')!.getAttribute('aria-selected')).toBe('true');
    expect((q(root, 'staking-console-amount') as HTMLInputElement).value).toBe('77');

    // Quick-fill preset chips in Action Console populate amount
    q(root, 'staking-console-preset-200')!.click();
    expect((q(root, 'staking-console-amount') as HTMLInputElement).value).toBe('200');
    q(root, 'staking-console-preset-max')!.click();
    expect((q(root, 'staking-console-amount') as HTMLInputElement).value).toBe('12.5');
  });
});

describe('Wealth Dashboard badges, tier warmup & AI budget', () => {
  it('Est. price badge and Free exit chip when the price is estimated and the 7 days elapsed', async () => {
    const p = makePerformance();
    const root = await mount(makeMock(() => ({ ...p, price: { ...p.price, source: 'est' }, timers: { ...p.timers, earlyExitFreeAtMs: NOW - 1, earlyExitFeeBp: 0 } })));
    expect(q(root, 'staking-price-source')!.textContent).toBe('Est.');
    expect(q(root, 'staking-exit-chip')!.textContent).toBe('Free exit');
  });

  it('Live APY badge instead of Sim when the APY source is live', async () => {
    const p = makePerformance();
    const root = await mount(makeMock(() => ({ ...p, apy: { ...p.apy, source: 'live' } })));
    expect(q(root, 'staking-kpi-apy')!.textContent).not.toContain('Sim APY');
    expect(q(root, 'staking-apy-source')!.textContent).toBe('Live APY');
  });

  it('tier card: warmup timer, progress bar and Top Up to Tier N pre-fills the console amount with the gap', async () => {
    const p = makePerformance();
    const root = await mount(makeMock(() => ({ ...p, timers: { ...p.timers, feeWarmupReadyAtMs: NOW + 3_600_000 * 5 } })));
    expect(q(root, 'staking-kpi-tier')!.textContent).toContain('Fee warmup 5h 00m');
    expect(q(root, 'staking-tier-progress')!.getAttribute('aria-valuenow')).toBe('35');
    const top = q(root, 'staking-topup-btn')!;
    expect(top.textContent).toBe('Top Up to Tier 3');
    click(root, 'staking-topup-btn');
    expect((q(root, 'staking-console-amount') as HTMLInputElement).value).toBe('129.5');
  });

  it('top tier: no Top Up button (corner)', async () => {
    const p = makePerformance();
    const root = await mount(makeMock(() => ({ ...p, perks: { ...p.perks, tier: 4, tierKey: 'patron', tierName: 'Planetary Patron', nextTierMinNear: null } })));
    expect(q(root, 'staking-topup-btn')).toBeNull();
    expect(q(root, 'staking-kpi-tier')!.textContent).toContain('Top tier reached');
  });

  it('AI budget: USD meter, calls, trade bonus, slot bar; T0 shows trial turns; trial hidden on higher tiers', async () => {
    const root = await mount(makeMock());
    expect(q(root, 'staking-ai-budget-usd')!.textContent).toContain('$0.10 / $0.50');
    expect(q(root, 'staking-ai-budget-calls')!.textContent).toContain('10 / 90');
    expect(q(root, 'staking-trade-bonus')!.textContent).toBe('Trade bonus +4 calls');
    expect(q(root, 'staking-trial-turns')).toBeNull();
    expect(q(root, 'staking-slot-bar')!.dataset.used).toBe('1');
    expect(q(root, 'staking-slot-bar')!.querySelectorAll('i').length).toBe(3);
    const p = makePerformance();
    const t0 = await mount(makeMock(() => ({ ...p, perks: { ...p.perks, tier: 0, tierKey: 'cadet', tierName: 'Cadet' }, aiBudget: { ...p.aiBudget, mode: 'trial', freeTrialTurnsRemaining: 3, colonySlotsMax: 0, colonySlotsUsed: 0 } })));
    expect(q(t0, 'staking-trial-turns')!.textContent).toBe('Trial turns left 3 / 5');
    expect(q(t0, 'staking-slot-bar')!.textContent).toContain('0 / 0');
  });
});

describe('Wealth Dashboard live behaviour', () => {
  it('yield counter shows micro-NEAR and ticks upward with the client clock', async () => {
    let now = NOW;
    const root = await mount(makeMock(), { now: () => now, tickMs: 5 });
    const el = q(root, 'staking-yield-live')!;
    expect(el.textContent).toBe('0.500000000');
    now += 3_600_000;
    await new Promise((r) => setTimeout(r, 30));
    const after = Number(el.textContent);
    expect(after).toBeGreaterThan(0.5);
    expect(Number(el.dataset.perSecond)).toBeGreaterThan(0);
  });

  it('compound is hidden at 0 rewards (KPI and console) and shown with rewards', async () => {
    const p = makePerformance();
    const zero = await mount(makeMock(() => ({ ...p, balances: { ...p.balances, accruedYieldNear: '0' } })));
    expect(q(zero, 'staking-compound-btn')).toBeNull();
    expect(q(zero, 'staking-console-compound')!.hidden).toBe(true);
    const some = await mount(makeMock());
    expect(q(some, 'staking-compound-btn')).not.toBeNull();
    expect(q(some, 'staking-console-compound')!.hidden).toBe(false);
  });

  it('compound click posts /stake/compound then refetches and the KPI reflects the new balances', async () => {
    const m = makeMock();
    m.post = (path) => {
      if (path === '/v1/near/stake/compound') {
        const p = makePerformance();
        m.perf = (w) => ({ ...makePerformance({}, w), balances: { ...p.balances, accruedYieldNear: '0', activeStakedNear: '60.5' } });
        return ok({});
      }
      return fail(500);
    };
    const root = await mount(m);
    const before = perfCalls(m).length;
    click(root, 'staking-compound-btn');
    await flush();
    await flush();
    expect(m.calls.some((c) => c.url === '/v1/near/stake/compound' && c.body?.accountId === 'pilot.mock')).toBe(true);
    expect(perfCalls(m).length).toBe(before + 1);
    expect(q(root, 'staking-compound-btn')).toBeNull();
    expect(q(root, 'staking-kpi-total')!.textContent).toContain('71.00');
    expect(q(root, 'staking-console-status')!.textContent).toContain('Compounded');
  });
});

describe('chart', () => {
  it('toggle 30d/90d/1y refetches with window= and redraws the SVG', async () => {
    const m = makeMock();
    const root = await mount(m);
    expect(perfCalls(m)[0]).toContain('window=30d');
    expect(q(root, 'staking-chart-svg')!.dataset.window).toBe('30d');
    expect(q(root, 'staking-chart-realized')).not.toBeNull();
    expect(q(root, 'staking-chart-projected')!.getAttribute('stroke-dasharray')).toBeTruthy();
    expect(q(root, 'staking-chart-realized')!.getAttribute('stroke-dasharray')).toBeNull();
    for (const w of ['90d', '1y'] as const) {
      click(root, `staking-chart-window-${w}`);
      await flush();
      expect(perfCalls(m).at(-1)).toContain(`window=${w}`);
      expect(q(root, 'staking-chart-svg')!.dataset.window).toBe(w);
      expect(q(root, `staking-chart-window-${w}`)!.getAttribute('aria-pressed')).toBe('true');
      expect(q(root, 'staking-chart-window-30d')!.getAttribute('aria-pressed')).toBe('false');
    }
    expect(root.querySelector('svg title')!.textContent).toContain('1y');
  });

  it('empty history shows an accessible empty chart; a failed window refetch keeps the last data (neg)', async () => {
    const p = makePerformance();
    const root = await mount(makeMock(() => ({ ...p, series: { window: '30d', points: [] } })));
    expect(q(root, 'staking-chart-svg')!.dataset.empty).toBe('1');
    expect(root.querySelector('svg desc')!.textContent).toBe('No history yet.');
    const m = makeMock();
    const r2 = await mount(m);
    m.perf = (w) => (w === '30d' ? makePerformance({}, w) : null);
    click(r2, 'staking-chart-window-90d');
    await flush();
    expect(q(r2, 'staking-kpi-total')).not.toBeNull();
    expect(q(r2, 'staking-dashboard-status')!.textContent).toContain('Could not refresh');
  });
});

describe('patron card shares', () => {
  it('X link carries tier text and url; NEAR Social click records the tx and opens the profile', async () => {
    const opened: string[] = [];
    const root = await mount(makeMock(), { openWindow: (u) => opened.push(u) });
    const x = q(root, 'staking-share-x') as HTMLAnchorElement;
    const u = new URL(x.href);
    expect(u.origin + u.pathname).toBe('https://twitter.com/intent/tweet');
    expect(u.searchParams.get('text')).toContain('Commander');
    expect(u.searchParams.get('text')).toContain('8.10%');
    expect(u.searchParams.get('url')).toBe('https://terra.test/me.html#staking');
    expect(q(root, 'staking-share-text')!.textContent).toBe(u.searchParams.get('text'));
    expect(q(root, 'staking-patron-planets')!.textContent).toContain('Kharon Dunes');
    click(root, 'staking-share-social');
    await flush();
    const tx = JSON.parse(q(root, 'staking-share-social')!.dataset.lastSocialTx!) as { contractId: string };
    expect(tx.contractId).toBe('v1.social08.testnet');
    expect(opened).toHaveLength(1);
  });
});

describe('graceful degradation', () => {
  it('performance 404: friendly notice, no KPI strip, no crash', async () => {
    const root = await mount(makeMock(() => null));
    expect(root.dataset.state).toBe('unavailable');
    expect(q(root, 'staking-dashboard-status')!.textContent).toContain('not available');
    expect(q(root, 'staking-kpi-total')).toBeNull();
  });

  it('malformed performance payload is treated as unavailable', async () => {
    const m = makeMock();
    m.fetch = async () => ok({ nope: true });
    const root = await mount(m);
    expect(root.dataset.state).toBe('unavailable');
  });

  it('action endpoints 404 (W28-04 not deployed): message shown, no refetch, UI intact', async () => {
    const m = makeMock();
    m.post = () => fail(404);
    const root = await mount(m);
    const before = perfCalls(m).length;
    click(root, 'staking-console-stake');
    click(root, 'staking-compound-btn');
    click(root, 'staking-stake-profits-btn');
    await flush();
    await flush();
    expect(q(root, 'staking-console-status')!.textContent).toContain('not available');
    expect(perfCalls(m).length).toBe(before);
    expect(q(root, 'staking-kpi-total')).not.toBeNull();
  });

  it('server rejection message is surfaced (neg)', async () => {
    const m = makeMock();
    m.post = () => fail(400, { message: 'Insufficient wallet balance' });
    const root = await mount(m);
    click(root, 'staking-console-stake');
    await flush();
    expect(q(root, 'staking-console-status')!.textContent).toBe('Insufficient wallet balance');
    expect(q(root, 'staking-console-status')!.dataset.tone).toBe('error');
  });

  it('anchors countdowns to server asOfMs (time.warp-safe) and unlocks compound when live yield ticks above 0', async () => {
    let clientNow = 1_000_000;
    const warpedServerNow = NOW + 10 * 86_400_000;
    const p = makePerformance();
    const m = makeMock(() => ({
      ...p,
      asOfMs: warpedServerNow,
      balances: { ...p.balances, accruedYieldNear: '0' },
      timers: {
        ...p.timers,
        feeWarmupReadyAtMs: warpedServerNow + 2 * 3_600_000,
        earlyExitFreeAtMs: warpedServerNow - 1_000,
        earlyExitFeeBp: 0,
      },
    }));
    const root = await mount(m, { now: () => clientNow, tickMs: 5 });
    expect(q(root, 'staking-kpi-tier')!.textContent).toContain('Fee warmup 2h 00m');
    expect(q(root, 'staking-exit-chip')!.textContent).toBe('Free exit');
    expect(q(root, 'staking-compound-btn')).toBeNull();
    clientNow += 60_000;
    await new Promise((r) => setTimeout(r, 25));
    expect(q(root, 'staking-compound-btn')).not.toBeNull();
    expect(q(root, 'staking-console-compound')!.hidden).toBe(false);
  });
});

describe('Patron Card canonical-only content-switch tabs & auto-nomination', () => {
  it('renders 3 canonical world tabs without dropdown or nominate button and switches tabs client-side without POST or button blink', async () => {
    const m = makeMock();
    const root = await mount(m);
    expect(q(root, 'staking-nominate-planet')).toBeNull();
    expect(q(root, 'staking-nominate-btn')).toBeNull();
    const tabs = [...root.querySelectorAll('[data-testid="staking-planet-chips"] [role="tab"]')];
    expect(tabs.map((t) => (t as HTMLElement).dataset.planetId)).toEqual([
      CANONICAL_PLANETS.desert.id,
      CANONICAL_PLANETS.ocean.id,
      CANONICAL_PLANETS.temperate.id,
    ]);

    const beforePosts = m.calls.filter((c) => c.method === 'POST').length;
    const beforePerfs = perfCalls(m).length;
    const socialBtn = q(root, 'staking-share-social') as HTMLButtonElement;
    expect(socialBtn.disabled).toBe(false);

    click(root, 'staking-planet-chip-ocean');
    await flush();
    expect(q(root, 'staking-planet-chip-ocean')!.getAttribute('aria-selected')).toBe('true');
    expect(q(root, 'staking-patron-competition-title')!.textContent).toContain('THALASSA VERDE');
    expect(q(root, 'staking-patron-status')!.hidden).toBe(true);
    expect(socialBtn.disabled).toBe(false);
    expect(m.calls.filter((c) => c.method === 'POST').length).toBe(beforePosts);
    expect(perfCalls(m).length).toBe(beforePerfs);

    click(root, 'staking-planet-chip-temperate');
    await flush();
    expect(q(root, 'staking-planet-chip-temperate')!.getAttribute('aria-selected')).toBe('true');
    expect(q(root, 'staking-patron-competition-title')!.textContent).toContain('GRANITE HOLLOW');
    expect(q(root, 'staking-patron-status')!.hidden).toBe(true);
    expect(m.calls.filter((c) => c.method === 'POST').length).toBe(beforePosts);
  });

  it('renders Current Competition & Patronage History tables, switches planets on chip click, and toggles history scope', async () => {
    const root = await mount(makeMock());
    expect(q(root, 'staking-patron-tables')).not.toBeNull();
    expect(q(root, 'staking-patron-competition-title')!.textContent).toContain('KHARON DUNES');
    expect(q(root, 'staking-patron-competition-summary')!.textContent).toContain('ISS whale.near');

    const desertContenders = [...root.querySelectorAll('[data-testid="staking-patron-contender-row"]')];
    expect(desertContenders.map((r) => (r as HTMLElement).dataset.account)).toEqual(['whale.near', 'pilot.mock']);
    expect((desertContenders[1] as HTMLElement).dataset.self).toBe('1');
    expect(q(root, 'staking-patron-history-title')!.textContent).toContain('KHARON DUNES');
    expect(root.querySelectorAll('[data-testid="staking-patron-history-row"]').length).toBe(2);

    // Switching planet chip updates both competition & history tables immediately
    click(root, 'staking-planet-chip-temperate');
    expect(q(root, 'staking-patron-competition-title')!.textContent).toContain('GRANITE HOLLOW');
    expect(q(root, 'staking-patron-competition-summary')!.textContent).toContain('Seat vacant');
    expect(root.querySelectorAll('[data-testid="staking-patron-contender-row"]').length).toBe(1);
    expect(q(root, 'staking-patron-history-title')!.textContent).toContain('GRANITE HOLLOW');
    expect(root.querySelectorAll('[data-testid="staking-patron-history-row"]').length).toBe(1);

    // Toggling history scope shows events across all 3 canonical worlds
    click(root, 'staking-patron-history-scope');
    expect(q(root, 'staking-patron-history-title')!.textContent).toContain('ALL 3 WORLDS');
    expect(root.querySelectorAll('[data-testid="staking-patron-history-row"]').length).toBe(4);
  });
});
