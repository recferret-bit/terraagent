// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { STAKING_RULES } from '@terra/contracts/staking/tiers';
import type { StakingOverviewResponse } from '@terra/contracts';
import { MePage } from './MePage';
import { fallbackOverview } from './sections/staking/stakingMath';
import { makeW12AchievementsFixture, makeW12ProfileFixture } from './testFixtures';

type Res = { ok: boolean; status: number; json(): Promise<unknown> };

const liveOverview = (): StakingOverviewResponse => ({
  ...fallbackOverview(200),
  network: 'mainnet',
  price: { nearUsd: 5.5, source: 'live', asOfMs: 1 },
  apy: { grossApyBp: 1000, netApyBp: 800, protocolYieldShareBp: 2000, source: 'live' },
  ecosystem: {
    totalNear: '3000000',
    entries: [
      { id: 'metapool', label: 'Meta Pool stNEAR', asset: 'stNEAR', tvlNear: '2000000', sharePct: 66.7 },
      { id: 'linear', label: 'LiNEAR', asset: 'LiNEAR', tvlNear: '600000', sharePct: 20 },
      { id: 'validator', label: 'Validators', asset: 'near', tvlNear: '400000', sharePct: 13.3 },
    ],
  },
});

const unauthed = (overview: () => Res): ((url: string) => Promise<Res>) => async (url) =>
  url.includes('/v1/near/staking/overview') ? overview() : { ok: false, status: 401, json: async () => ({}) };

const notFound = (): Res => ({ ok: false, status: 404, json: async () => ({}) });
/** API unreachable (dev server without a backend: the proxy answers 502): the preview falls back to local data. */
const serverDown = (): Res => ({ ok: false, status: 502, json: async () => ({}) });
const q = (root: HTMLElement, id: string): HTMLElement | null => root.querySelector(`[data-testid="${id}"]`);

async function mountSignedOut(hash: string, overview: () => Res, search = ''): Promise<HTMLElement> {
  window.localStorage.clear();
  const root = document.createElement('div');
  await new MePage(root, { search, hash, fetch: unauthed(overview) }).load();
  await new Promise((r) => setTimeout(r, 0));
  return root;
}

describe('W28-09 /me.html#staking public preview', () => {
  it('server reports W28 off (overview 404): tab and staking plate are hidden (server-side wave fencing)', async () => {
    const root = await mountSignedOut('#staking?amount=50', notFound);
    expect(q(root, 'me-tab-staking')?.hidden).toBe(true);
    expect(root.querySelector<HTMLElement>('#staking')?.hidden).toBe(true);
  });

  it('signed out + #staking?amount=50: full preview, no auth wall, CTA and ecosystem render (fallback path)', async () => {
    const root = await mountSignedOut('#staking?amount=50', serverDown);
    expect(q(root, 'me-auth-prompt')).toBeNull();
    expect(q(root, 'me-tab-staking')?.textContent).toBe('STAKING');
    for (const id of ['staking-preview', 'staking-tier-matrix', 'staking-projection', 'staking-ecosystem', 'staking-connect-cta', 'staking-apy-badge']) {
      expect(q(root, id), id).not.toBeNull();
    }
    expect(q(root, 'staking-connect-cta')?.textContent).toBe('Connect NEAR Wallet to Stake 50 NEAR');
    expect(q(root, 'staking-apy-badge')?.textContent).toBe('7.20% Sim APY');
    expect(q(root, 'staking-price-badge')?.textContent).toContain('Est.');
    expect(q(root, 'staking-ecosystem-metapool')?.textContent).toContain('—');
    expect(q(root, 'staking-dashboard-slot')).toBeNull();
  });

  it('live overview: Live APY badge, Live price, ecosystem TVL and server tier rows', async () => {
    const root = await mountSignedOut('#staking?amount=200', () => ({ ok: true, status: 200, json: async () => liveOverview() }));
    expect(q(root, 'staking-apy-badge')?.textContent).toBe('8.00% Live APY');
    expect(q(root, 'staking-apy-badge')?.dataset.live).toBe('1');
    expect(q(root, 'staking-price-badge')?.textContent).toContain('Live');
    expect(q(root, 'staking-ecosystem-metapool')?.textContent).toContain('2,000,000 NEAR');
    expect(q(root, 'staking-ecosystem-total')?.textContent).toBe('3,000,000 NEAR');
  });

  it('a malformed overview payload degrades to the fallback badges instead of crashing', async () => {
    const root = await mountSignedOut('#staking?amount=50', () => ({ ok: true, status: 200, json: async () => ({ nope: 1 }) }));
    expect(q(root, 'staking-apy-badge')?.dataset.live).toBe('0');
    expect(q(root, 'staking-apy-badge')?.textContent).toContain('Sim APY');
  });

  it('highlights the tier the amount reaches and lists every tier row from the data table', async () => {
    const root = await mountSignedOut('#staking?amount=200', notFound);
    expect(q(root, 'staking-tier-matrix')?.dataset.reachedTier).toBe('3');
    expect(q(root, 'staking-tier-row-3')?.classList.contains('is-reached')).toBe(true);
    expect(q(root, 'staking-tier-row-2')?.classList.contains('is-reached')).toBe(false);
    expect(root.querySelectorAll('[data-testid^="staking-tier-row-"]').length).toBe(5);
    expect(q(root, 'staking-tier-row-2')?.textContent).toContain('24h warmup');
  });

  it('typing an amount updates the CTA text, projections and highlighted tier live', async () => {
    const root = await mountSignedOut('#staking?amount=50', serverDown);
    const input = q(root, 'staking-amount-input') as HTMLInputElement;
    const yearly = q(root, 'staking-projection-yearly')?.textContent;
    input.value = '500';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(q(root, 'staking-connect-cta')?.textContent).toBe('Connect NEAR Wallet to Stake 500 NEAR');
    expect(q(root, 'staking-projection-yearly')?.textContent).not.toBe(yearly);
    expect(q(root, 'staking-projection-yearly')?.textContent).toContain('36.00');
    expect(q(root, 'staking-tier-matrix')?.dataset.reachedTier).toBe('4');
    input.value = '-9';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(q(root, 'staking-connect-cta')?.textContent).toBe(`Connect NEAR Wallet to Stake ${STAKING_RULES.defaultPreviewNear} NEAR`);
  });

  it('junk or oversized hash amounts are validated (default / clamp)', async () => {
    const junk = await mountSignedOut('#staking?amount=abc', notFound);
    expect(q(junk, 'staking-connect-cta')?.dataset.amount).toBe(String(STAKING_RULES.defaultPreviewNear));
    const huge = await mountSignedOut('#staking?amount=99999999', notFound);
    expect(q(huge, 'staking-connect-cta')?.dataset.amount).toBe('1000000');
  });

  it('W28 off (?waves=..27): no STAKING tab and the signed-out auth wall is unchanged', async () => {
    const root = await mountSignedOut('#staking?amount=50', notFound, '?waves=..27');
    expect(q(root, 'me-tab-staking')).toBeNull();
    expect(q(root, 'staking-preview')).toBeNull();
    expect(q(root, 'me-auth-prompt')).not.toBeNull();
  });

  it('signed out on another hash keeps the auth prompt (staking only bypasses for #staking)', async () => {
    const root = await mountSignedOut('#pilot', notFound);
    expect(q(root, 'me-auth-prompt')).not.toBeNull();
    expect(q(root, 'staking-preview')).toBeNull();
  });

  it('logged in: preview stays visible next to the W28-10 dashboard slot; CTA hidden for a linked wallet', async () => {
    const root = document.createElement('div');
    const profile = makeW12ProfileFixture();
    const achievements = makeW12AchievementsFixture();
    const page = new MePage(root, {
      search: '?as=w12',
      hash: '#staking?amount=50',
      fetch: async (url) =>
        url.includes('/v1/near/staking/overview') ? notFound() : { ok: true, status: 200, json: async () => (url.includes('/profile') ? profile : achievements) },
    });
    await page.load();
    await new Promise((r) => setTimeout(r, 0));
    expect(q(root, 'staking-dashboard-slot')).not.toBeNull();
    expect(q(root, 'staking-tier-matrix')).not.toBeNull();
    expect(q(root, 'me-section-staking')).not.toBeNull();
    expect(q(root, 'me-section-pilot')).not.toBeNull();
    const hasWallet = Boolean(profile.identity.accountId);
    expect(q(root, 'staking-connect-cta') === null).toBe(hasWallet);
  });
});
