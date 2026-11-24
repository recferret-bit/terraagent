// @vitest-environment jsdom
import { CANONICAL_PLANETS } from '@terra/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { createLocalModeFetch } from './localModeSim';
import { MePage } from './MePage';
import { renderStakingDashboard } from './sections/staking/dashboard/StakingDashboard';

const q = (root: ParentNode, id: string): HTMLElement | null => root.querySelector(`[data-testid="${id}"]`);

const flush = async (): Promise<void> => {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
};

beforeEach(() => {
  window.localStorage.clear();
});

describe('/me rework: Staking tab styling & position', () => {
  it('places bold white+orange-shadow STAKING tab & section immediately after PILOT', async () => {
    const root = document.createElement('div');
    const page = new MePage(root, { search: '?host=local', fetch: createLocalModeFetch(() => 1_700_000_000_000) });
    await page.load();
    await flush();

    const tabs = [...root.querySelectorAll('.ta-me-tab')];
    expect(tabs.map((t) => t.textContent)).toEqual([
      'PILOT',
      'STAKING',
      'PROGRESS',
      'PLANETS',
      'HISTORY',
      'ACHIEVEMENTS',
      'PLAY',
    ]);
    expect(tabs[1]?.classList.contains('ta-me-tab--staking')).toBe(true);

    const sections = [...root.querySelectorAll('main > section')].map((s) => s.id);
    expect(sections).toEqual(['pilot', 'staking', 'progress', 'planets', 'history', 'achievements', 'play']);
  });
});

describe('/me rework: standalone Top-Up card block', () => {
  it('renders Top-Up card in its own dedicated block outside KPI strip and supports card click, pre-fill, and 1-click stake', async () => {
    const now = 1_700_000_000_000;
    const dash = renderStakingDashboard({
      accountId: 'local-commander.terraagent.mock',
      amount: 25,
      fetch: createLocalModeFetch(() => now),
      search: '?host=local',
      now: () => now,
      tickMs: 0,
    });
    await dash.ready;

    const topUpBlock = q(dash.el, 'staking-topup-block')!;
    const kpiStrip = q(dash.el, 'staking-kpi-strip')!;
    const tierCard = q(dash.el, 'staking-kpi-tier')!;
    expect(topUpBlock.contains(tierCard)).toBe(true);
    expect(kpiStrip.contains(tierCard)).toBe(false);
    expect(tierCard.classList.contains('is-clickable')).toBe(false);

    tierCard.click();
    expect((q(dash.el, 'staking-console-amount') as HTMLInputElement).value).toBe('25');

    q(dash.el, 'staking-topup-btn')!.click();
    expect((q(dash.el, 'staking-console-amount') as HTMLInputElement).value).toBe('10');

    q(dash.el, 'staking-topup-stake-btn')!.click();
    await flush();
    expect(q(dash.el, 'staking-kpi-tier')!.textContent).toContain('T1 Scout');
    expect(q(dash.el, 'staking-topup-btn')!.textContent).toBe('Top Up to Tier 2');

    (q(dash.el, 'staking-console-amount') as HTMLInputElement).value = '490';
    q(dash.el, 'staking-console-stake')!.click();
    await flush();
    expect(q(dash.el, 'staking-kpi-tier')!.textContent).toContain('T4 Planetary Patron');
    expect(q(dash.el, 'staking-topup-btn')).toBeNull();
    expect(q(dash.el, 'staking-topup-stake-btn')).toBeNull();
    dash.dispose();
  });
});

describe('/me rework: top-left ? question icon tips on Staking & AI blocks', () => {
  it('toggles tip panels on click, closes prior tip, dismisses on Escape/outside/close, and does not trigger Top-Up click', async () => {
    const root = document.createElement('div');
    const page = new MePage(root, { search: '?host=local', fetch: createLocalModeFetch(() => 1_700_000_000_000) });
    await page.load();
    await flush();

    expect(q(root, 'help-tip-btn-section-staking')).toBeNull();
    expect(q(root, 'staking-intro-banner')).not.toBeNull();
    expect(q(root, 'staking-intro-banner')!.textContent).toContain('100% PRINCIPAL CUSTODY');
    expect(q(root, 'staking-calculator-block')).toBeNull();

    const tipIds = [
      'section-pilot', 'ai-settings', 'staking-dashboard', 'staking-topup', 'staking-patronage',
      'staking-kpis', 'staking-total', 'staking-yield', 'staking-apy', 'staking-income',
      'staking-ai-budget', 'staking-chart', 'staking-console', 'staking-txs',
      'staking-ecosystem',
    ];
    for (const id of tipIds) {
      expect(q(root, `help-tip-btn-${id}`), `missing ? button for ${id}`).not.toBeNull();
      expect(q(root, `help-tip-panel-${id}`)!.hidden).toBe(true);
    }
    const effBtn = q(root, 'staking-effective-tooltip')!;
    const effPanel = q(root, 'help-tip-panel-staking-effective')!;
    expect(effPanel.hidden).toBe(true);

    const amountInput = q(root, 'staking-console-amount') as HTMLInputElement;
    amountInput.value = '50';
    const topupTipBtn = q(root, 'help-tip-btn-staking-topup')!;
    const topupTipPanel = q(root, 'help-tip-panel-staking-topup')!;
    topupTipBtn.click();
    expect(topupTipPanel.hidden).toBe(false);
    expect(amountInput.value).toBe('50');

    effBtn.click();
    expect(topupTipPanel.hidden).toBe(true);
    expect(effPanel.hidden).toBe(false);

    const aiTipBtn = q(root, 'help-tip-btn-ai-settings')!;
    const aiTipPanel = q(root, 'help-tip-panel-ai-settings')!;
    aiTipBtn.click();
    expect(effPanel.hidden).toBe(true);
    expect(aiTipPanel.hidden).toBe(false);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(aiTipPanel.hidden).toBe(true);

    aiTipBtn.click();
    q(root, 'help-tip-close-ai-settings')!.click();
    expect(aiTipPanel.hidden).toBe(true);

    topupTipBtn.click();
    document.body.click();
    expect(topupTipPanel.hidden).toBe(true);

    // Focus restoration when Escape is pressed with focus inside an attached tip panel
    document.body.appendChild(root);
    try {
      aiTipBtn.click();
      q(root, 'help-tip-close-ai-settings')!.focus();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(aiTipPanel.hidden).toBe(true);
      expect(document.activeElement).toBe(aiTipBtn);
    } finally {
      root.remove();
    }
  });

  it('renders top-left ? tips on signed-out #staking public preview blocks', async () => {
    const root = document.createElement('div');
    const unauthFetch: ReturnType<typeof createLocalModeFetch> = async (input, init) => {
      if (input.includes('/v1/auth/refresh') || input.includes('/v1/me/')) {
        return { ok: false, status: 401, json: async () => ({ message: 'Unauthorized' }) };
      }
      return createLocalModeFetch(() => 1_700_000_000_000)(input, init);
    };
    const page = new MePage(root, { hash: '#staking', fetch: unauthFetch });
    await page.load();
    await flush();

    expect(q(root, 'help-tip-btn-section-staking')).toBeNull();
    expect(q(root, 'staking-intro-banner')).not.toBeNull();
    expect(q(root, 'staking-calculator-block')).toBeNull();
    for (const id of ['staking-income', 'staking-tiers', 'staking-ecosystem']) {
      expect(q(root, `help-tip-btn-${id}`), `missing signed-out ? tip for ${id}`).not.toBeNull();
    }
    const tiersBtn = q(root, 'help-tip-btn-staking-tiers')!;
    const tiersPanel = q(root, 'help-tip-panel-staking-tiers')!;
    expect(tiersPanel.hidden).toBe(true);
    tiersBtn.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    expect(tiersPanel.hidden).toBe(false);
    expect(q(tiersPanel, 'staking-tier-matrix')).not.toBeNull();
    tiersBtn.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 200));
    expect(tiersPanel.hidden).toBe(true);
  });
});

describe('/me rework: local mode (?host=local) actions & 1-minute timings', () => {
  it('executes Stake, Compound, Unstake, Withdraw, Profits, Faucet, Nominate & 1-minute timer transitions', async () => {
    let now = 1_700_000_000_000;
    const dash = renderStakingDashboard({
      accountId: 'local-commander.terraagent.mock',
      amount: 100,
      defaultPlanetId: CANONICAL_PLANETS.temperate.id,
      fetch: createLocalModeFetch(() => now),
      search: '?host=local',
      now: () => now,
      tickMs: 10,
    });
    dash.setRewardMultiplier(10_080);
    await dash.ready;

    q(dash.el, 'staking-console-stake')!.click();
    await flush();
    expect(q(dash.el, 'staking-kpi-total')!.textContent).toContain('100.00 NEAR');
    expect(q(dash.el, 'staking-warmup-chip')!.textContent).toContain('1m 00s');

    now += 61_000;
    await new Promise((r) => setTimeout(r, 35));
    await flush();
    expect(q(dash.el, 'staking-warmup-chip')!.textContent).toBe('Full tier fee active');
    expect(q(dash.el, 'staking-exit-chip')!.textContent).toBe('Free exit');

    q(dash.el, 'staking-compound-btn')!.click();
    await flush();
    expect(Number.parseFloat(q(dash.el, 'staking-kpi-total')!.querySelector('b')!.textContent!)).toBeGreaterThan(100.1);

    (q(dash.el, 'staking-console-amount') as HTMLInputElement).value = '40';
    q(dash.el, 'staking-console-unstake')!.click();
    await flush();
    expect((q(dash.el, 'staking-console-withdraw') as HTMLButtonElement).disabled).toBe(true);

    now += 61_000;
    await new Promise((r) => setTimeout(r, 35));
    await flush();
    const withdrawBtn = q(dash.el, 'staking-console-withdraw') as HTMLButtonElement;
    expect(withdrawBtn.disabled).toBe(false);
    expect(withdrawBtn.classList.contains('btn-primary')).toBe(true);
    withdrawBtn.click();
    await flush();
    expect(q(dash.el, 'staking-console-status')!.textContent).toContain('Withdrawn');

    q(dash.el, 'staking-stake-profits-btn')!.click();
    await flush();
    expect(q(dash.el, 'staking-console-status')!.textContent).toContain('stNEAR');

    q(dash.el, 'staking-local-faucet-btn')!.click();
    await flush();
    expect(q(dash.el, 'staking-console-status')!.textContent).toContain('Minted +500 NEAR');

    (q(dash.el, 'staking-console-amount') as HTMLInputElement).value = '500';
    q(dash.el, 'staking-console-stake')!.click();
    await flush();
    q(dash.el, 'staking-nominate-btn')!.click();
    await flush();
    expect(q(dash.el, 'staking-console-status')!.textContent).toContain(`Lead Patron of Granite Hollow (${CANONICAL_PLANETS.temperate.id})`);
    expect(q(dash.el, 'staking-patron-status')!.textContent).toContain(`Lead Patron of Granite Hollow (${CANONICAL_PLANETS.temperate.id})`);

    // Local mode REST guard rejects paid sovereign NFT / non-canonical planets with 400
    const badRes = await createLocalModeFetch(() => now)('/v1/near/staking/patron/nominate', {
      method: 'POST',
      body: JSON.stringify({ accountId: 'local-commander.terraagent.mock', planetId: 'pl_sovereign_nft_01' }),
    });
    expect(badRes.status).toBe(400);
    expect(q(dash.el, 'staking-share-social')!.classList.contains('btn-ghost')).toBe(true);
    expect(q(dash.el, 'staking-nominate-btn')!.classList.contains('btn-ghost')).toBe(true);
    expect(q(dash.el, 'staking-chart-window-90d')!.classList.contains('btn-ghost')).toBe(true);
    dash.dispose();
  });
});

describe('/me rework: open tip & nomination draft survive 60s maturity refetch and rapid double-clicks are guarded', () => {
  it('preserves open ? tip and planet draft across 60s timer refetch and prevents duplicate in-flight stakes', async () => {
    let now = 1_700_000_000_000;
    const baseFetch = createLocalModeFetch(() => now);
    let stakePosts = 0;
    const slowFetch: typeof baseFetch = async (input, init) => {
      if (input.endsWith('/near/stake')) {
        stakePosts += 1;
        await new Promise((r) => setTimeout(r, 20));
      }
      return baseFetch(input, init);
    };
    const dash = renderStakingDashboard({
      accountId: 'local-commander.terraagent.mock',
      amount: 50,
      fetch: slowFetch,
      search: '?host=local',
      now: () => now,
      tickMs: 10,
    });
    await dash.ready;

    // Rapid double-click on Top-Up Instant Stake (+10 NEAR) only executes once
    const instantBtn = q(dash.el, 'staking-topup-stake-btn')!;
    instantBtn.click();
    instantBtn.click();
    await new Promise((r) => setTimeout(r, 40));
    await flush();
    expect(stakePosts).toBe(1);
    expect(q(dash.el, 'staking-kpi-total')!.textContent).toContain('10.00 NEAR');

    // Open Top-Up ? tip and switch canonical planet selection before 60s maturity refetch fires
    q(dash.el, 'help-tip-btn-staking-topup')!.click();
    expect(q(dash.el, 'help-tip-panel-staking-topup')!.hidden).toBe(false);
    q(dash.el, 'staking-planet-chip-desert')!.click();

    now += 61_000;
    await new Promise((r) => setTimeout(r, 35));
    await flush();
    expect(q(dash.el, 'help-tip-panel-staking-topup')!.hidden).toBe(false);
    expect((q(dash.el, 'staking-nominate-planet') as HTMLSelectElement).value).toBe(CANONICAL_PLANETS.desert.id);
    dash.dispose();
  });
});

describe('/me rework: local mode validation, live yield compound & AI sync', () => {
  it('rejects empty, zero, negative, insufficient wallet NEAR, and insufficient USDC profits cleanly, and switches chart windows', async () => {
    let now = 1_700_000_000_000;
    const dash = renderStakingDashboard({
      accountId: 'local-commander.terraagent.mock',
      amount: 999999,
      fetch: createLocalModeFetch(() => now),
      search: '?host=local',
      now: () => now,
      tickMs: 10,
    });
    dash.setRewardMultiplier(10_080);
    await dash.ready;

    for (const bad of ['', '0', '-5']) {
      (q(dash.el, 'staking-console-amount') as HTMLInputElement).value = bad;
      q(dash.el, 'staking-console-stake')!.click();
      expect(q(dash.el, 'staking-console-status')!.dataset.tone).toBe('error');
    }

    (q(dash.el, 'staking-console-amount') as HTMLInputElement).value = '999999';
    q(dash.el, 'staking-console-stake')!.click();
    await flush();
    expect(q(dash.el, 'staking-console-status')!.dataset.tone).toBe('error');

    (q(dash.el, 'staking-console-usdc') as HTMLInputElement).value = '999999';
    q(dash.el, 'staking-stake-profits-btn')!.click();
    await flush();
    expect(q(dash.el, 'staking-console-status')!.dataset.tone).toBe('error');

    // Pre-60s live-ticked Compound button appears in detached DOM after 5s and compounds live yield
    (q(dash.el, 'staking-console-amount') as HTMLInputElement).value = '100';
    q(dash.el, 'staking-console-stake')!.click();
    await flush();
    expect(q(dash.el, 'staking-compound-btn')).toBeNull();
    now += 5_000;
    await new Promise((r) => setTimeout(r, 35));
    expect(q(dash.el, 'staking-compound-btn')).not.toBeNull();
    q(dash.el, 'staking-compound-btn')!.click();
    await flush();
    expect(q(dash.el, 'staking-console-status')!.textContent).toContain('Compounded');

    // Chart window toggle (30D -> 90D -> 1Y)
    q(dash.el, 'staking-chart-window-90d')!.click();
    await flush();
    expect(q(dash.el, 'staking-chart-svg')!.getAttribute('data-window')).toBe('90d');
    q(dash.el, 'staking-chart-window-1y')!.click();
    await flush();
    expect(q(dash.el, 'staking-chart-svg')!.getAttribute('data-window')).toBe('1y');
    dash.dispose();
  });
});

describe('/me rework: local mode Staking -> NEAR.AI Autopilot sync & LST unstake spill', () => {
  it('syncs Staking -> NEAR.AI Autopilot badge live, verifies TEE with clean URL + Bearer header, and unstakes across LST buckets', async () => {
    const root = document.createElement('div');
    const localFetch = createLocalModeFetch(() => 1_700_000_000_000);
    let verifyAuthHeader = '';
    let verifyUrl = '';
    const wrappedFetch: typeof localFetch = (input, init) => {
      if (input.includes('/v1/me/ai-settings/verify')) {
        verifyUrl = input;
        verifyAuthHeader = (init?.headers as Record<string, string> | undefined)?.Authorization ?? '';
      }
      return localFetch(input, init);
    };
    const page = new MePage(root, { search: 'host=local&waves=W12,W28', fetch: wrappedFetch });
    await page.load();
    await flush();

    expect(q(root, 'me-ai-badge')!.textContent).toBe('DETERMINISTIC FALLBACK');
    q(root, 'me-ai-verify-btn')!.click();
    await flush();
    expect(verifyUrl).toBe('/v1/me/ai-settings/verify');
    expect(verifyAuthHeader).toBe('Bearer local-mode-token');
    expect(q(root, 'me-ai-status')!.textContent).toContain('stake ≥10 NEAR');

    // Stake trade profits (40 USDC -> 10 stNEAR): live-unlocks MANAGED STAKER AI ACTIVE and TEE verification
    (q(root, 'staking-console-usdc') as HTMLInputElement).value = '40.00';
    q(root, 'staking-stake-profits-btn')!.click();
    await flush();
    expect(q(root, 'me-ai-badge')!.textContent).toBe('MANAGED STAKER AI ACTIVE');

    q(root, 'me-ai-verify-btn')!.click();
    await flush();
    expect(q(root, 'me-ai-status')!.textContent).toContain('Probe OK');

    // Save & disconnect BYOK key while staked >= 10 NEAR: keeps MANAGED STAKER AI ACTIVE
    (q(root, 'me-ai-key-input') as HTMLInputElement).value = 'sk-local-test-9876';
    q(root, 'me-ai-save-btn')!.click();
    await flush();
    expect(q(root, 'me-ai-badge')!.textContent).toBe('NEAR.AI CONNECTED');
    q(root, 'me-ai-clear-btn')!.click();
    await flush();
    expect(q(root, 'me-ai-badge')!.textContent).toBe('MANAGED STAKER AI ACTIVE');

    // Unstaking 10 NEAR with dropdown still on Native NEAR spills cleanly from stNEAR bucket and drops AI badge back
    (q(root, 'staking-console-amount') as HTMLInputElement).value = '10';
    q(root, 'staking-console-unstake')!.click();
    await flush();
    expect(q(root, 'staking-console-status')!.textContent).toContain('Unstake of 10');
    expect(q(root, 'me-ai-badge')!.textContent).toBe('DETERMINISTIC FALLBACK');
  });
});
