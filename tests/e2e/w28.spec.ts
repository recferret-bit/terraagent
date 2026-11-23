import { execFileSync } from 'node:child_process';
import { CANONICAL_PLANETS } from '@terra/contracts';
import type { BrowserContext, Page } from '@playwright/test';
import { devConsole, expect, expectNoPageErrors, hostMode, loadScenario, openColonyTab, test } from './harness';
import { ROOT } from './harness/ports';
import {
  getJson, noHorizontalScroll, pilotAccount, pilotIdentity, planetIdOf, POOL, postJson, RIVAL, setSlider, walletPerks,
} from './w28-lib';

/**
 * W28 Staking Overhaul, 4-Tier Orbital Patronage & Wealth Dashboard — demo steps 1–8
 * (`docs/plan/waves/W28-staking-overhaul.md`). Mock NEAR (`NEAR_MODE=mock`): the `w28` scenario seeds a rival 500 NEAR
 * Lead Patron and the pilot's linked wallet (1000 NEAR, 50 USDC) through `W28ScenarioSeedService`.
 * Steps 1–2 are client pages (both hosts). Steps 3–7 need the app (server host). Step 8 runs the deploy dry-run only:
 * live testnet is frozen.
 */
const local = hostMode() === 'local';
const serverOnly = () => test.skip(local, 'needs the app (server host)');
const DAY_S = 86_400;

let context: BrowserContext;
let page: Page;
let wallet = '';
let planetId = '';

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
});

test.afterAll(async () => {
  await context?.close();
});

test('@hack 1. /landing.html: STAKE · LIVE APY pill, 0–500 NEAR tier slider → STAKE 200 NEAR · UNLOCK TIER 3 → /me.html#staking?amount=200', async ({ browser }) => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto('/landing.html', { waitUntil: 'commit', timeout: 120_000 });
  await p.waitForSelector('#econ-stake-slider', { state: 'attached', timeout: 120_000 });
  await expect(p.getByTestId('landing-stake-pill')).toHaveAttribute('href', /\/me\.html#staking/, { timeout: 90_000 });
  await expect(p.locator('.stake-pill-badge')).toContainText('APY');
  await expect(p.locator('#econ-stake-slider')).toHaveAttribute('max', '500');
  for (const [near, tier, fee] of [[10, 1, '65'], [50, 2, '50'], [500, 4, '25']] as const) {
    await setSlider(p, '#econ-stake-slider', near);
    await expect(p.getByTestId('landing-stake-cta')).toContainText(`UNLOCK TIER ${tier}`);
    await expect(p.locator('#economics')).toContainText(`${fee} bp`);
  }
  await setSlider(p, '#econ-stake-slider', 200);
  const cta = p.getByTestId('landing-stake-cta');
  await expect(cta).toHaveText(/STAKE 200 NEAR · UNLOCK TIER 3 →/);
  await expect(cta).toHaveAttribute('href', '/me.html#staking?amount=200');
  await ctx.close();
});

test('@hack 2. /me.html#staking?amount=50 logged out: public preview, Sim APY, 4-tier matrix, ecosystem TVL, Connect CTA, no auth wall', async ({ browser }) => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto('/me.html#staking?amount=50');
  await expect(p.getByTestId('staking-preview')).toBeVisible({ timeout: 30_000 });
  await expect(p.getByTestId('me-auth-prompt')).toHaveCount(0);
  await expect(p.getByTestId('staking-apy-badge')).toContainText(/APY/);
  await expect(p.getByTestId('staking-intro-banner')).toBeVisible();
  await expect(p.getByTestId('staking-calculator-block')).toHaveCount(0);
  await expect(p.getByTestId('staking-projection')).toBeVisible();
  await p.getByTestId('help-tip-btn-staking-tiers').hover();
  await expect(p.getByTestId('help-tip-panel-staking-tiers')).toBeVisible();
  await expect(p.getByTestId('staking-tier-matrix')).toHaveAttribute('data-reached-tier', '2');
  await expect(p.getByTestId('staking-ecosystem')).toBeVisible();
  await expect(p.getByTestId('staking-connect-cta')).toHaveText(/Connect NEAR Wallet to Stake 50 NEAR/);
  await p.getByTestId('staking-amount-input').fill('500');
  await expect(p.getByTestId('staking-connect-cta')).toHaveText(/Stake 500 NEAR/);
  await expect(p.getByTestId('staking-tier-matrix')).toHaveAttribute('data-reached-tier', '4');
  await p.setViewportSize({ width: 375, height: 812 }); // mobile touch layout
  await noHorizontalScroll(p);
  await ctx.close();
});

// Steps 3–7 share the seeded pilot (`wallet`, `planetId`) and run in file order on one worker.
test('3. verified pilot with 0 NEAR staked: FREE TEE TRIAL (5 / 5) on the Director; a guest gets no trial', async () => {
  test.setTimeout(180_000);
  serverOnly();
  await loadScenario(page, 'w28', { skip: '1', shadow: '0', crt: '0', wind: '0' }, { as: 'w28', timeout: 90_000 });
  planetId = await planetIdOf(page);
  const api = page.request;
  await expect.poll(async () => (await pilotIdentity(api)).accountId, { timeout: 20_000 }).not.toBeNull();
  const me = await pilotIdentity(api);
  wallet = me.accountId ?? '';
  expect(wallet).toBe(pilotAccount(me.playerId));

  const perks = await getJson<{ perks: { tier: number }; aiBudget: { mode: string; trialEligible: boolean; freeTrialTurnsRemaining: number } }>(api, `/v1/near/staking/perks?accountId=${wallet}`);
  expect(perks.status).toBe(200);
  expect(perks.body.perks.tier).toBe(0);
  expect(perks.body.aiBudget).toMatchObject({ trialEligible: true, freeTrialTurnsRemaining: 5 });

  const pill = page.getByTestId('staking-pill');
  await expect(pill).toBeVisible({ timeout: 20_000 });
  await expect(pill).toHaveAttribute('data-tier', '0');

  // Director card: verified pilot, nothing staked → FREE TEE TRIAL with 5 turns (the scenario colony's sim id `col_0`
  // differs from its `core.colony` row; the panel sends the planet slot so the server finds it).
  await openColonyTab(page, 'director');
  const card = page.getByTestId('director-ai-access');
  await expect(card).toHaveAttribute('data-state', 'trial', { timeout: 30_000 });
  await expect(page.getByTestId('director-ai-badge')).toContainText(/FREE TEE TRIAL \(5 \/ 5/);
  await page.getByTestId('director-ai-tee-proof').click();
  await expect(page.getByTestId('tee-modal-ai-access')).toHaveAttribute('data-state', 'trial');
  await page.keyboard.press('Escape');

  // The in-game staking panel asks for the session's wallet (no deed, no colony account): wallet-first status.
  const status = await getJson<{ accountId: string; colonyId?: string }>(api, '/v1/near/staking', true);
  expect(status.status).toBe(200);
  expect(status.body.accountId).toBe(wallet);
  expect(status.body.colonyId).toBeUndefined();

  const guest = await getJson<{ aiBudget: { trialEligible: boolean; freeTrialTurnsRemaining: number } }>(api, '/v1/near/staking/perks?accountId=nobody-guest.near');
  expect(guest.body.aiBudget).toMatchObject({ trialEligible: false, freeTrialTurnsRemaining: 0 });
});

test('4. stake 50 NEAR with zero colonies: 0.65% at t=0, warmup → 0.50% after 24h, compound (0% fee), /me.html#staking dashboard', async () => {
  test.setTimeout(120_000);
  serverOnly();
  const api = page.request;
  const staked = await postJson<{ perks: { tier: number; feeTier: number; platformFeeBp: number; feeWarmupReadyAtMs: number | null } }>(api, '/v1/near/stake', { accountId: wallet, pool: POOL, amount: '50' });
  expect(staked.status).toBe(200);
  expect(staked.body.perks).toMatchObject({ tier: 2, feeTier: 1, platformFeeBp: 65 });
  expect(staked.body.perks.feeWarmupReadyAtMs).not.toBeNull();

  await devConsole(page, `time.warp ${DAY_S + 60}`, 30_000);
  const warmed = await walletPerks(api, wallet);
  expect(warmed).toMatchObject({ tier: 2, platformFeeBp: 50, feeWarmupReadyAtMs: null });

  const compounded = await postJson<{ compoundedNear?: string; position: { staked: string } }>(api, '/v1/near/stake/compound', { accountId: wallet, pool: POOL });
  expect(compounded.status).toBe(200);
  expect(Number(compounded.body.compoundedNear)).toBeGreaterThan(0);
  expect(Number(compounded.body.position.staked)).toBeGreaterThan(50);

  const me = await context.newPage();
  await me.goto('/me.html?as=w28#staking');
  await expect(me.getByTestId('staking-dashboard')).toBeVisible({ timeout: 30_000 });
  for (const k of ['total', 'yield', 'apy', 'income', 'effective', 'tier']) await expect(me.getByTestId(`staking-kpi-${k}`)).toBeVisible();
  await expect(me.getByTestId('staking-kpi-tier')).toContainText('2');
  await expect(me.getByTestId('staking-ai-budget')).toBeVisible();
  await expect(me.getByTestId('staking-chart')).toBeVisible();
  await me.getByTestId('staking-chart-window-1y').click();
  await expect(me.getByTestId('staking-patron-card')).toBeVisible();
  await expect(me.getByTestId('staking-share-x')).toHaveAttribute('href', /twitter\.com\/intent\/tweet/);
  await me.close();
});

test('5. unstake 45 within 7 days: 25 bp exit fee, instant downgrade to Tier 0; after unbonding (warp 2d) one-step withdraw', async () => {
  test.setTimeout(120_000);
  serverOnly();
  const api = page.request;
  const out = await postJson<{ earlyExitFeeBp: number; earlyExitFeeNear: string; perks: { tier: number } }>(api, '/v1/near/unstake', { accountId: wallet, pool: POOL, amount: '45' });
  expect(out.status).toBe(200);
  expect(out.body.earlyExitFeeBp).toBe(25);
  expect(out.body.earlyExitFeeNear).toBe('0.1125');
  expect(out.body.perks.tier).toBe(0);

  const early = await postJson<{ errorCode: string }>(api, '/v1/near/withdraw', { accountId: wallet, pool: POOL });
  expect(early.status).toBe(409);
  await devConsole(page, `time.warp ${2 * DAY_S + 60}`, 30_000);
  const done = await postJson<{ position: { withdrawable: string; unbonding: string } }>(api, '/v1/near/withdraw', { accountId: wallet, pool: POOL });
  expect(done.status).toBe(200);
  expect(Number(done.body.position.unbonding)).toBe(0);
});

test('6. scale to 550 NEAR on a canonical public planet: overtakes the 500 NEAR rival; sovereign NFT planets rejected (400); Tier 4 HUD; slots 12', async () => {
  test.setTimeout(120_000);
  serverOnly();
  const api = page.request;
  const canonPlanetId = CANONICAL_PLANETS.temperate.id;
  const before = await getJson<{ leadPatron: { accountId: string } | null }>(api, `/v1/near/staking/prestige?planetId=${canonPlanetId}`);
  expect(before.body.leadPatron?.accountId).toBe(RIVAL);
  expect((await postJson(api, '/v1/near/stake', { accountId: wallet, pool: POOL, amount: '545' })).status).toBe(200);
  // Paid sovereign NFT / non-canonical planets are rejected from Planetary Patronage (400)
  expect((await postJson(api, '/v1/near/staking/patron/nominate', { accountId: wallet, planetId: 'pl_sovereign_nft_01' })).status).toBe(400);

  const me = await context.newPage();
  await me.goto('/me.html?as=w28#staking');
  await expect(me.getByTestId('staking-dashboard')).toBeVisible({ timeout: 30_000 });
  const options = await me.getByTestId('staking-nominate-planet').locator('option').evaluateAll((els) => els.map((o) => (o as HTMLOptionElement).value));
  expect(options).toEqual([CANONICAL_PLANETS.desert.id, CANONICAL_PLANETS.ocean.id, CANONICAL_PLANETS.temperate.id]);
  await me.getByTestId('staking-nominate-planet').selectOption(canonPlanetId);
  await me.getByTestId('staking-nominate-btn').click();
  await expect(me.getByTestId('staking-console-status')).toContainText(`Lead Patron of Granite Hollow (${canonPlanetId})`, { timeout: 15_000 });
  await expect(me.getByTestId('staking-patron-planets')).toContainText(canonPlanetId, { timeout: 15_000 });
  await me.close();
  const after = await getJson<{ leadPatron: { accountId: string; carrierName: string; protocolFeeShareBp: number } }>(api, `/v1/near/staking/prestige?planetId=${canonPlanetId}`);
  expect(after.body.leadPatron).toMatchObject({ accountId: wallet, protocolFeeShareBp: 1500 });
  expect(after.body.leadPatron.carrierName).toMatch(/^ISS /);
  const perks = await walletPerks(api, wallet);
  expect(perks.tier).toBe(4);
  expect(perks.leadPatronPlanetIds).toContain(canonPlanetId);
  const full = await getJson<{ perks: { maxAiColonySlots: number } }>(api, `/v1/near/staking/perks?accountId=${wallet}`);
  expect(full.body.perks.maxAiColonySlots).toBe(12);
  await page.reload();
  await expect(page.getByTestId('staking-pill')).toHaveAttribute('data-tier', '4', { timeout: 60_000 });
});

test('7. /trade.html: fee pill, Stake Trade Profits (10 USDC → stNEAR), RampView quotes 10.00 USDC as 10000000 atomic, dry', async () => {
  test.setTimeout(120_000);
  serverOnly();
  const api = page.request;
  const profits = await postJson<{ quote: { amountInAtomic: string; amountOutNear: string }; position: { asset?: string } | null }>(api, '/v1/near/stake/profits', { accountId: wallet, amountUsdc: '10.00' });
  expect(profits.status).toBe(200);
  expect(profits.body.quote.amountInAtomic).toBe('10000000');
  expect(profits.body.position?.asset).toBe('stNEAR');

  const trade = await context.newPage();
  await trade.goto(`/trade.html?as=w28&planet=${encodeURIComponent(planetId)}`);
  await expect(trade.getByTestId('trade-1click-ramp')).toBeVisible({ timeout: 30_000 });
  await expect(trade.getByTestId('staking-pill')).toHaveAttribute('data-tier', '4', { timeout: 20_000 });
  await expect(trade.getByTestId('trade-fee-pill')).toContainText('FEE 0.25%');
  await expect(trade.getByRole('region', { name: 'Order ticket' })).toContainText('0.25% Platform Fee');
  const bodies: Array<Record<string, unknown>> = [];
  trade.on('request', (r) => { if (r.url().includes('/v1/near/intents/quote') && r.method() === 'POST') bodies.push(r.postDataJSON() as Record<string, unknown>); });
  const origin = trade.getByTestId('ramp-origin');
  const usdc = await origin.locator('option').filter({ hasText: /USDC/ }).first().getAttribute('value');
  if (usdc) await origin.selectOption(usdc);
  await trade.getByTestId('ramp-amount').fill('10.00');
  await trade.getByTestId('ramp-quote-btn').click();
  await expect.poll(() => bodies.length, { timeout: 15_000 }).toBeGreaterThan(0);
  expect(bodies[0]).toMatchObject({ amount: '10000000', dry: true });
  await expect(trade.getByTestId('ramp-quote-result')).not.toContainText(/quintillion|e\+/);
  await trade.close();
});

test('8. verifier.terraagent.testnet deploy plan (dry-run only: live testnet is frozen) lists the verifier with strict balances', () => {
  const out = execFileSync(process.execPath, ['scripts/dev/deploy-testnet-contracts.mjs', '--network', 'testnet', '--dry-run', '--only', 'verifier'], { cwd: ROOT, encoding: 'utf8' });
  expect(out).toContain('verifier.terraagent.testnet');
  expect(out).toMatch(/strict_balances"?\s*:\s*true/);
});

test('TA_WAVES isolation & local/mock mode + negative/corner checks', async () => {
  serverOnly();
  const res = await getJson(page.request, '/v1/near/staking/overview?amount=50');
  expect(res.status).toBe(200);

  // Local dev uses local mocked chain + mock AI across all 11 NEAR ports.
  const status = await getJson<{ nearMode: string; ports: Array<{ mode: string }>; ai: { mode: string } }>(page.request, '/v1/near/status');
  expect(status.status).toBe(200);
  expect(['mock', 'local']).toContain(status.body.nearMode);
  expect(status.body.ports).toHaveLength(11);
  expect(status.body.ports.every((p) => p.mode === 'mock')).toBe(true);
  expect(status.body.ai.mode).toBe('mock');

  // Wallet-tx descriptor + negative validation checks.
  const walletTx = await getJson<{ contractId: string }>(page.request, '/v1/near/staking/wallet-tx?action=stake_payable&amountNear=10');
  expect(walletTx.status).toBe(200);
  expect(walletTx.body.contractId).toBe('protocol.terraagent.mock');
  expect((await getJson(page.request, '/v1/near/staking/wallet-tx?action=bogus&amountNear=10')).status).toBe(400);
  expect((await getJson(page.request, '/v1/near/staking/wallet-tx?action=deposit_and_stake_lst&amountNear=0.001')).status).toBe(400);

  // Negative & corner staking checks: AI actor rejected, bad window 400, negative projection clamped to 0.
  const aiStake = await page.request.post('/v1/near/stake', {
    headers: { 'x-actor': 'ai' },
    data: { accountId: wallet, pool: POOL, amount: '5' },
  });
  expect(aiStake.status()).toBe(403);
  expect((await getJson(page.request, `/v1/near/staking/performance?accountId=${wallet}&window=7d`)).status).toBe(400);
  const clamped = await getJson<{ projection: { amountNear: number } }>(page.request, '/v1/near/staking/overview?amount=-5');
  expect(clamped.status).toBe(200);
  expect(clamped.body.projection.amountNear).toBe(0);
});

test('/me.html?host=local rework: bold white+orange STAKING tab, standalone Top-Up block, ? tips, local staking, rename & auth', async ({ browser }) => {
  const ctx = await browser.newContext();
  const me = await ctx.newPage();
  expectNoPageErrors(me);
  await me.goto('/me.html?host=local', { timeout: 60_000 });
  await expect(me.getByTestId('staking-dashboard')).toBeVisible({ timeout: 30_000 });

  await expect(me.locator('.ta-me-tab')).toHaveText(['PILOT', 'STAKING', 'PROGRESS', 'PLANETS', 'HISTORY', 'ACHIEVEMENTS', 'PLAY']);
  await expect(me.getByTestId('me-tab-pilot')).toHaveAttribute('aria-current', 'true');
  await expect(me.getByTestId('me-tab-pilot')).toHaveClass(/is-active/);
  const stakingTabStyle = await me.getByTestId('me-tab-staking').evaluate((node) => {
    const cs = getComputedStyle(node);
    return { weight: Number(cs.fontWeight), color: cs.color, shadow: cs.textShadow };
  });
  expect(stakingTabStyle.weight).toBeGreaterThanOrEqual(700);
  expect(stakingTabStyle.color).toBe('rgb(242, 244, 247)');
  expect(stakingTabStyle.shadow).not.toBe('none');

  // Clicking a nav tab activates it immediately, updates hash, and scrolls smoothly instead of teleporting
  await me.getByTestId('me-tab-planets').click();
  await expect(me.getByTestId('me-tab-planets')).toHaveAttribute('aria-current', 'true');
  await expect(me.getByTestId('me-tab-planets')).toHaveClass(/is-active/);
  await expect.poll(() => new URL(me.url()).hash).toBe('#planets');
  await expect.poll(async () => (await me.getByTestId('me-section-planets').boundingBox())?.y ?? 9999).toBeLessThan(260);
  await me.getByTestId('me-tab-staking').click();
  await expect(me.getByTestId('me-tab-staking')).toHaveAttribute('aria-current', 'true');

  // Patron selector restricts nominations exclusively to the 3 canonical worlds
  await me.getByTestId('staking-planet-chip-desert').click();
  await expect(me.getByTestId('staking-nominate-planet')).toHaveValue(CANONICAL_PLANETS.desert.id);

  // Standalone clickable Top-Up block outside KPI strip + 1-click stake + live Ecosystem TVL sync
  await expect(me.getByTestId('staking-ecosystem-total')).toHaveText('125,000 NEAR');
  await expect(me.getByTestId('staking-topup-block').getByTestId('staking-kpi-tier')).toBeVisible();
  await expect(me.getByTestId('staking-kpi-strip').getByTestId('staking-kpi-tier')).toHaveCount(0);
  await me.getByTestId('staking-topup-stake-btn').click();
  await expect(me.getByTestId('staking-kpi-tier')).toContainText('T1 Scout');
  await expect(me.getByTestId('staking-ecosystem-total')).toHaveText('125,010 NEAR');
  await expect(me.getByTestId('me-ai-badge')).toHaveText('MANAGED STAKER AI ACTIVE');

  // Top-left ? tips on Staking & AI blocks + hover Orbital Patronage popup + persistence across preview amount edits
  await me.getByTestId('help-tip-btn-staking-patronage').hover();
  await expect(me.getByTestId('help-tip-panel-staking-patronage')).toBeVisible();
  await expect(me.getByTestId('staking-active-tier-matrix')).toBeVisible();

  await me.getByTestId('help-tip-btn-ai-settings').click();
  await expect(me.getByTestId('help-tip-panel-ai-settings')).toBeVisible();
  await me.getByTestId('help-tip-btn-staking-income').click();
  await expect(me.getByTestId('help-tip-panel-ai-settings')).toBeHidden();
  await expect(me.getByTestId('help-tip-panel-staking-income')).toBeVisible();
  await me.getByTestId('staking-amount-input').fill('200');
  await expect(me.getByTestId('help-tip-panel-staking-income')).toBeVisible();

  // Unstake, faucet, profits, inline rename, sign-out, and local sign-in all work without a backend
  await me.getByTestId('staking-console-amount').fill('5');
  await me.getByTestId('staking-console-unstake').click();
  await expect(me.getByTestId('staking-unbonding-countdown')).toContainText('withdrawable in');
  await me.getByTestId('staking-local-faucet-btn').click();
  await expect(me.getByTestId('staking-console-status')).toContainText('Minted +500 NEAR');

  await me.getByTestId('me-pilot-rename').click();
  await me.getByTestId('me-pilot-rename-input').fill('Commander Sol');
  await me.getByTestId('me-pilot-rename-save').click();
  await expect(me.getByTestId('me-pilot-handle')).toHaveText('Commander Sol');

  await me.getByTestId('pilot-sign-out').click();
  await expect(me.getByTestId('staking-connect-cta')).toContainText('Connect NEAR Wallet to Stake 200 NEAR');
  // Connect NEAR Wallet -> NEAR -> Meteor Wallet works offline in ?host=local and isolates new persona balances
  await me.getByTestId('staking-connect-cta').click();
  await me.getByTestId('pilot-provider-dialog').getByTestId('continue-near').click();
  await me.getByTestId('near-wallet-modal').getByTestId('near-wallet-meteor').click();
  await expect(me.getByTestId('me-pilot-handle')).toHaveText('Meteor Wallet');
  await expect(me.getByTestId('staking-kpi-total')).toContainText('0.00 NEAR');

  await me.getByTestId('pilot-sign-out').click();
  await me.getByTestId('me-tab-pilot').click();
  await expect(me.getByTestId('me-auth-prompt')).toBeVisible();
  await me.getByTestId('me-auth-prompt').getByTestId('pilot-sign-in').click();
  await me.getByTestId('me-auth-prompt').getByTestId('local-mock-player-input').fill('Captain Lyra');
  await me.getByTestId('me-auth-prompt').getByTestId('local-mock-player-submit').click();
  await expect(me.getByTestId('me-pilot-handle')).toHaveText('Captain Lyra');
  await ctx.close();
});
