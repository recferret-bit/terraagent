import type { BrowserContext, Page } from '@playwright/test';
import {
  devConsole, expect, hostMode, loadScenario, readTick, test,
} from './harness';

/**
 * W06 Invisible Chain — demo steps 1–7 (docs/plan/waves/W06-invisible-chain.md).
 * Steps 1, 2, 4, 6 and 7 are the hackathon slice (`npm run e2e -- --waves 06 --hack`).
 * Step 3 (Settings → Account) and step 5 (a second device) are not in this landing.
 */
test.describe.configure({ mode: 'serial' });

const local = hostMode() === 'local';
const serverOnly = () => test.skip(local, 'needs the app (server host)');
const PILOT = 'test-pilot.terraagent.mock';
const RETRY_SUBJECT = 'relay-guest';

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
  await expect.poll(async () => (await readTick(target)) ?? 0, { timeout: 15_000 }).toBeGreaterThan(from);
}

/** Save progress → Google mock. `test-pilot` uses the preset; any other subject is typed. The game page stays put. */
async function saveWithGoogle(target: Page, subject: string): Promise<void> {
  const stay = target.url().split('#')[0];
  await target.locator('[data-testid=save-progress]').click();
  const opened = target.waitForEvent('popup', { timeout: 15_000 });
  await target.locator('[data-testid=continue-google]').click();
  const popup = await opened;
  const closed = popup.waitForEvent('close', { timeout: 20_000 });
  if (subject === 'test-pilot') await popup.locator('#mo-preset').click();
  else {
    await popup.locator('#mo-name').fill(subject);
    await popup.locator('#mo-use').click();
  }
  await closed;
  const account = subject === 'test-pilot' ? PILOT : `${subject}.terraagent.mock`;
  await expect(target.locator('[data-testid=pilot-id]')).toHaveText(`Pilot ID ${account}`, { timeout: 30_000 });
  expect(target.url().split('#')[0]).toBe(stay);
}

async function setRelayerFail(target: Page, rate: number): Promise<void> {
  const out = await devConsole(target, `near.mock.fail relayer ${rate}`, 15_000);
  expect(out).toContain(`fail rate for relayer is ${rate}`);
}

test('@hack 1. open ?scenario=w06 as a guest with a colony; the chip says Guest pilot and the tick rises', async () => {
  serverOnly();
  const t0 = await loadScenario(page, 'w06', {}, { as: 'w06' });
  await expect(page.locator('[data-testid=pilot-chip]')).toContainText('Guest pilot');
  await tickAdvances(page, t0);
});

test('@hack 2. Save progress → Continue with Google (mock) → test-pilot; the page stays and shows the Pilot ID', async () => {
  serverOnly();
  test.setTimeout(90_000);
  await saveWithGoogle(page, 'test-pilot');
  await expect(page.locator('#mo-preset')).toHaveCount(0);
});

test('3. Settings → Account', () => {
  test.skip(true, 'not in this landing');
});

test('@hack 4. /dev/chain/ lists the pilot and a mock hash; the receipt shows FINAL and the relayer', async () => {
  serverOnly();
  test.setTimeout(90_000);
  const explorer = await context.newPage();
  await explorer.goto('/dev/chain/');
  const accounts = explorer.getByRole('tab', { name: 'ACCOUNTS' });
  await expect(accounts).toBeVisible({ timeout: 15_000 });
  await accounts.click();
  await expect(explorer.locator('#app')).toContainText(PILOT, { timeout: 20_000 });
  await explorer.getByRole('tab', { name: 'RECEIPTS' }).click();
  const link = explorer.locator('tr', { hasText: 'submitMetaTx' }).locator('a.hash-link', { hasText: 'mock:' });
  await expect(link.first()).toBeVisible({ timeout: 30_000 });
  await link.first().click();
  await expect(explorer).toHaveURL(/\/dev\/chain\/tx\//, { timeout: 15_000 });
  await expect(explorer.locator('body')).toContainText('FINAL', { timeout: 20_000 });
  await expect(explorer.locator('body')).toContainText('relayer.terraagent.mock');
  await explorer.close();
});

test('5. Returning login on a second device', () => {
  test.skip(true, 'not in this landing');
});

test('@hack 6. relayer fail shows the orbit retry toast; clearing the fail rate and Retry removes it', async ({ browser }) => {
  serverOnly();
  test.setTimeout(120_000);
  await setRelayerFail(page, 1);
  // A second WebGL view does not come up while this page still holds the context.
  await page.goto('about:blank');
  const fresh = await browser.newContext();
  const other = await fresh.newPage();
  try {
    await loadScenario(other, 'w06', {}, { as: 'w06b', timeout: 45_000 });
    await saveWithGoogle(other, RETRY_SUBJECT);
    await expect(other.locator('[data-testid=orbit-toast]')).toContainText("Couldn't save to orbit, retrying", { timeout: 30_000 });
    await setRelayerFail(other, 0);
    await other.locator('[data-testid=orbit-retry]').click();
    await expect.poll(async () => {
      const toast = await other.locator('[data-testid=orbit-toast]').count();
      const saving = await other.locator('[data-testid=orbit-save]').count();
      return toast === 0 && saving === 0;
    }, { timeout: 20_000 }).toBe(true);
  } finally {
    await devConsole(other, 'near.mock.fail relayer 0', 15_000).catch(() => undefined);
    await fresh.close();
  }
});

test('@hack 7. waves ..05 hides the pilot chip and shows the chain page Off; the tick still moves', async () => {
  serverOnly();
  test.setTimeout(90_000);
  const t0 = await loadScenario(page, 'w06', { waves: '..05' }, { as: 'w06-off', timeout: 45_000 });
  await expect(page.locator('[data-testid=pilot-chip]')).toHaveCount(0);
  await tickAdvances(page, t0);
  await page.goto('/dev/chain/?waves=..05');
  await expect(page.locator('body')).toContainText('Off', { timeout: 15_000 });
  await expect(page.locator('body')).not.toContainText('MOCK CHAIN EXPLORER');
});
