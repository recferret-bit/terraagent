import type { BrowserContext, Page } from '@playwright/test';
import {
  devConsole,
  expect,
  expectNoPageErrors,
  hostMode,
  loadScenario,
  openColonyTab,
  readTick,
  test,
  waitForTick,
} from './harness';

/**
 * W20 Colony Deed & Staking (F6, mock) — demo steps 1–7 (`docs/plan/waves/W20-colony-deed.md`).
 * Steps 1, 2, 7 are the hackathon slice (`npm run e2e -- --waves ..20 --hack`).
 * Steps 3, 4, 5, 6 cover public share page, non-settled staking lock, settle + claim + signer reject/approve + stake,
 * unstake + 4-epoch unbonding + withdraw, and resilience / dev chain explorer views.
 */
test.describe.configure({ mode: 'serial' });

const local = hostMode() === 'local';
const serverOnly = () => test.skip(local, 'needs the app (server host)');

let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
});

test.afterAll(async () => {
  await context?.close();
});

async function tickAdvances(target: Page, from: number): Promise<void> {
  await expect
    .poll(async () => (await readTick(target)) ?? 0, { timeout: 15_000 })
    .toBeGreaterThan(from);
}

async function closeDevConsole(target: Page): Promise<void> {
  const input = target.locator('[data-testid=dev-console] input');
  if (await input.isVisible().catch(() => false)) {
    await target.keyboard.press('Backquote');
  }
}

test('@hack 1. open /play.html?scenario=w20 -> open Colony Deed -> see card with name, planet, Stage 4, Terraform 40%, and Recorded on NEAR (mock) receipt', async () => {
  serverOnly();
  const t0 = await loadScenario(page, 'w20', { skip: '1' }, { as: 'w20', timeout: 45_000 });
  await tickAdvances(page, t0);

  const trigger = page.locator('[data-testid="colony-deed-btn"]');
  await expect(page.getByTestId('colony-tab-deed')).toBeVisible({ timeout: 15_000 });
  await openColonyTab(page, 'deed'); // the Deed button lives in the Colony book's Deed tab
  await expect(trigger).toBeVisible({ timeout: 15_000 });
  await trigger.click();

  const panel = page.locator('[data-testid="deed-panel"]');
  await expect(panel).toHaveAttribute('data-open', 'true');
  await expect(panel).toHaveAttribute('data-settled', 'false');
  await expect(page.locator('[data-testid="deed-version-badge"]')).toHaveText('v1', {
    timeout: 15_000,
  });
  await expect(page.locator('[data-testid="deed-stats"]')).toContainText('Aegis Spire');
  await expect(page.locator('[data-testid="deed-stats"]')).toContainText('Stage 4');
  await expect(page.locator('[data-testid="deed-stats"]')).toContainText(/40\s*%/);
  await expect(page.locator('[data-testid="deed-receipt-link"]')).toHaveText(
    'Recorded on NEAR (mock)',
  );
  await expect(page.locator('[data-testid="deed-receipt-link"]')).toHaveAttribute(
    'href',
    /\/dev\/chain\/\?tab=deeds/,
  );
  expectNoPageErrors(page);
});

test('@hack 2. deed.bump terraform 10 -> warp 20 past debounce window -> toast shows Terraform 50 % and card history gains v2', async () => {
  serverOnly();
  const bumpOut = await devConsole(page, 'deed.bump terraform 10', 15_000);
  expect(bumpOut).toContain('Terraform 50 %');

  await devConsole(page, 'warp 20', 15_000);
  await expect(page.locator('[data-testid="deed-toast"]')).toContainText(
    'Your Deed was updated: Terraform 50 %',
    { timeout: 15_000 },
  );
  await expect(page.locator('[data-testid="deed-version-badge"]')).toHaveText('v2', {
    timeout: 15_000,
  });
  await expect(page.locator('[data-testid="deed-stats"]')).toContainText(/50\s*%/);
  await expect(page.locator('[data-testid="deed-history-item"]')).toHaveCount(2);
  expectNoPageErrors(page);
});

test('3. Share on X and public /deed/<tokenId> page render OG card and PNG image without auth', async () => {
  serverOnly();
  const shareBtn = page.locator('[data-testid="deed-share-x-btn"]');
  await expect(shareBtn).toBeVisible();

  const shareHref = await page.locator('[data-testid="deed-share-link"]').getAttribute('href');
  expect(shareHref).toMatch(/^\/deed\/deed%3Acol_0/);

  const sharePage = await context.newPage();
  await sharePage.goto(shareHref ?? '/deed/deed%3Acol_0');
  await expect(sharePage.locator('[data-testid="deed-share-card"]')).toBeVisible({
    timeout: 15_000,
  });
  await expect(sharePage.locator('[data-testid="deed-share-image"]')).toHaveAttribute(
    'src',
    /\/v1\/(?:near\/deed|deeds)\/deed%3Acol_0\/image\.png/,
  );
  expectNoPageErrors(sharePage);
  await sharePage.close();
});

test('4. Non-settled deed already exposes Day-1 staking controls and staker perks banner', async () => {
  serverOnly();
  await expect(page.locator('[data-testid="staking-locked-banner"]')).toBeHidden();
  await expect(page.locator('[data-testid="staking-controls"]')).toBeVisible();
  await expect(page.locator('[data-testid="staking-perks-banner"]')).toContainText(
    'Stake >= 10 NEAR from Day 1',
  );
});

test('5. deed.settle turns card to gold Settled variant, fires settler toast, claims account, tests signer Reject, then stakes 10 NEAR', async () => {
  serverOnly();
  const settleOut = await devConsole(page, 'deed.settle', 15_000);
  expect(settleOut).toContain('settled');

  await expect(page.locator('[data-testid="deed-panel"]')).toHaveAttribute('data-settled', 'true', {
    timeout: 15_000,
  });
  await expect(page.locator('[data-testid="achievement-toast"]')).toContainText('Settler', {
    timeout: 15_000,
  });
  await expect(page.locator('[data-testid="staking-controls"]')).toBeVisible();
  await expect(page.locator('[data-testid="staking-real-near-copy"]')).toHaveText(
    'Real NEAR from your wallet — not game currency, no in-game bonus',
  );
  await expect(page.locator('[data-testid="staking-account-status"]')).toHaveText(
    'Account not claimed',
  );

  // Try Stake before claiming -> inline message "Claim your colony account to stake"
  await closeDevConsole(page);
  await page.locator('[data-testid="staking-stake-btn"]').click();
  await expect(page.locator('[data-testid="staking-status-msg"]')).toHaveText(
    'Claim your colony account to stake',
  );

  // Claim account via mock wallet signer modal -> Approve
  await page.locator('[data-testid="staking-claim-btn"]').click();
  await expect(page.locator('[data-testid="mock-wallet-signer-modal"]')).toBeVisible();
  await page.locator('[data-testid="signer-approve-btn"]').click();
  await expect(page.locator('[data-testid="staking-account-status"]')).toContainText('Claimed', {
    timeout: 15_000,
  });

  // Stake 10 NEAR -> click Reject in mock signer modal -> "Cancelled in wallet"
  await page.locator('[data-testid="staking-amount-input"]').fill('10');
  await page.locator('[data-testid="staking-stake-btn"]').click();
  await expect(page.locator('[data-testid="mock-wallet-signer-modal"]')).toBeVisible();
  await page.locator('[data-testid="signer-reject-btn"]').click();
  await expect(page.locator('[data-testid="staking-status-msg"]')).toHaveText(
    'Cancelled in wallet',
  );
  await expect(page.locator('[data-testid="staking-staked-value"]')).toContainText('0 NEAR staked');

  // Stake 10 NEAR -> click Approve -> position shows 10 NEAR staked and rewards accrue on time.warp 86400
  await page.locator('[data-testid="staking-stake-btn"]').click();
  await expect(page.locator('[data-testid="mock-wallet-signer-modal"]')).toBeVisible();
  await page.locator('[data-testid="signer-approve-btn"]').click();
  await expect(page.locator('[data-testid="staking-staked-value"]')).toContainText(
    '10 NEAR staked',
    { timeout: 15_000 },
  );
  await expect(page.locator('[data-testid="staking-perks-banner"]')).toContainText('PERKS ACTIVE');

  await devConsole(page, 'time.warp 86400', 15_000);
  await expect(page.locator('[data-testid="staking-rewards-value"]')).toContainText('0.00197', {
    timeout: 15_000,
  });
});

test('6. Unstake -> Unbonding (4 epochs) -> warp 100 -> Withdraw returns balance to wallet; resilience & dev explorer tabs', async () => {
  serverOnly();
  await closeDevConsole(page);
  await page.locator('[data-testid="staking-unstake-btn"]').click();
  await expect(page.locator('[data-testid="staking-status-msg"]')).toContainText(
    'Unbonding (4 epochs)',
    { timeout: 15_000 },
  );

  await devConsole(page, 'warp 100', 15_000);
  await closeDevConsole(page);
  const withdrawBtn = page.locator('[data-testid="staking-withdraw-btn"]');
  await expect(withdrawBtn).toBeEnabled({ timeout: 15_000 });
  await withdrawBtn.click();
  await expect(page.locator('[data-testid="staking-wallet-balance"]')).toContainText('100.00197', {
    timeout: 15_000,
  });

  // Resilience: near.mock.fail deed 1 -> deed.bump shows retrying; near.mock.fail deed 0 clears
  await devConsole(page, 'near.mock.fail deed 1', 15_000);
  await devConsole(page, 'deed.bump terraform 10', 15_000);
  await expect(page.locator('[data-testid="deed-pending-badge"]')).toContainText('Pending', {
    timeout: 15_000,
  });
  await devConsole(page, 'near.mock.fail deed 0', 15_000);
  await devConsole(page, 'time.warp 600', 15_000);
  await expect(page.locator('[data-testid="deed-pending-badge"]')).toHaveText('Confirmed', {
    timeout: 15_000,
  });

  // Dev chain explorer Deeds & Staking tabs
  const explorer = await context.newPage();
  await explorer.goto('/dev/chain/?tab=deeds&tokenId=deed%3Acol_0');
  await expect(explorer.locator('table.xt')).toContainText('deed:col_0', {
    timeout: 15_000,
  });
  await explorer.getByRole('tab', { name: 'STAKING' }).click();
  await expect(explorer.locator('table.xt')).toContainText('9%', {
    timeout: 15_000,
  });
  await explorer.close();
});

test('@hack 7. With waves=..19: no Deed button in HUD and existing chain.deed rows stay untouched in DB', async () => {
  serverOnly();
  const beforeRes = await page.request.get('/v1/deeds/deed%3Acol_0');
  expect(beforeRes.status()).toBe(200);
  const beforeBody = (await beforeRes.json()) as {
    tokenId: string;
    planetId: string;
    version: number;
    settled: boolean;
  };
  expect(beforeBody.tokenId).toBe('deed:col_0');

  const q = new URLSearchParams({
    join: beforeBody.planetId,
    skip: '1',
    waves: '..19',
    as: 'w20',
  });
  await page.goto(`/play.html?${q.toString()}`);
  const t0 = await waitForTick(page, () => true, 45_000);
  await tickAdvances(page, t0);
  await expect(page.locator('[data-testid="colony-deed-btn"]')).toHaveCount(0);
  await expect(page.getByTestId('colony-tab-deed')).toHaveCount(0); // no empty Deed tab in the Colony book

  // Verify existing deed row in DB remained untouched while W20 was off on client
  const afterRes = await page.request.get('/v1/deeds/deed%3Acol_0');
  expect(afterRes.status()).toBe(200);
  const afterBody = (await afterRes.json()) as {
    tokenId: string;
    version: number;
    settled: boolean;
  };
  expect(afterBody.tokenId).toBe(beforeBody.tokenId);
  expect(afterBody.version).toBe(beforeBody.version);
  expect(afterBody.settled).toBe(beforeBody.settled);
  expectNoPageErrors(page);
});
