import type { BrowserContext, Page } from '@playwright/test';
import {
  devConsole,
  expect,
  expectNoPageErrors,
  loadScenario,
  test,
  waitForTick,
} from './harness';
import {
  BOUNTY_METALS,
  CARGO_METALS,
  FEE_METALS,
  FUND_METALS,
  HIRE_METALS,
  cargoMetals,
  closeDevConsole,
  hiveId,
  mercCount,
  openPlanetItem,
  openSecondColony,
  planetIdFrom,
  serverOnly,
  voteYesOnOpen,
} from './w22-lib';

/**
 * W22 Treasury & Bounties demo (`docs/plan/waves/W22-treasury-bounties.md`).
 * `@hack` is steps 1, 2, 3 (terraform boost), 4, 5 and 8. Meteor shield, mercenaries and expiry stay in the full run.
 */
test.describe.configure({ mode: 'serial' });

const AS_A = 'w22a';
const AS_B = 'w22b';

let context: BrowserContext;
let page: Page;
let closeOther: (() => Promise<void>) | undefined;
let colonyB: Page | undefined;
let planetId = '';
let nestBountyId = '';
let defendBountyId = '';
let mercBountyId = '';

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
});

test.afterAll(async () => {
  await closeOther?.().catch(() => undefined);
  await context?.close();
});

async function seatB(browser: import('@playwright/test').Browser): Promise<Page> {
  if (colonyB) return colonyB;
  const opened = await openSecondColony(browser, planetId, AS_B);
  closeOther = opened.close;
  colonyB = opened.page;
  return colonyB;
}

test('@hack 1. scenario=w22 opens Council with the seeded fee balance, 2 members and no proposals', async () => {
  serverOnly();
  test.setTimeout(120_000);
  await loadScenario(page, 'w22', { skip: '1' }, { as: AS_A, timeout: 90_000 });
  await expect.poll(() => cargoMetals(page, AS_A), { timeout: 30_000 }).toBe(CARGO_METALS);
  await openPlanetItem(page, 'council');
  await expect(page.getByTestId('council-balance')).toHaveText(String(FEE_METALS), { timeout: 30_000 });
  await expect(page.getByTestId('council-members')).toContainText('2 members');
  await expect(page.getByTestId('council-empty')).toHaveText('No proposals');
  expectNoPageErrors(page);
});

test('@hack 2. treasury.fund deposits whole metals.t1 and the Council balance rises by that amount', async () => {
  serverOnly();
  test.setTimeout(90_000);
  const listed = await devConsole(page, 'planet');
  planetId = planetIdFrom(listed);
  const funded = await devConsole(page, `treasury.fund ${planetId} ${FUND_METALS}`, 30_000);
  expect(funded).toContain(`metals.t1 ${FUND_METALS}`);
  expect(funded).toContain(String(FEE_METALS + FUND_METALS));
  await closeDevConsole(page);
  await openPlanetItem(page, 'council');
  await expect(page.getByTestId('council-balance')).toHaveText(String(FEE_METALS + FUND_METALS), { timeout: 20_000 });
  expectNoPageErrors(page);
});

test('3. Meteor shield passes when both colonies vote yes and the HUD shows the shield badge', async ({ browser }) => {
  serverOnly();
  test.setTimeout(300_000);
  await passProject(browser, 'meteor_shield', 'effect-badge-meteor_shield');
  expectNoPageErrors(page);
});

test('@hack 3. Terraform boost passes when both colonies vote yes and the HUD shows the boost badge', async ({ browser }) => {
  serverOnly();
  test.setTimeout(300_000);
  await passProject(browser, 'terraform_boost', 'effect-badge-terraform_boost');
  expectNoPageErrors(page);
});

test('@hack 4. posting Clear nest for 200 metals shows an escrow receipt and drops poster cargo by 200', async () => {
  serverOnly();
  test.setTimeout(90_000);
  const nest = await hiveId(page);
  const before = await cargoMetals(page, AS_A);
  await openPlanetItem(page, 'bounties');
  await page.getByTestId('bounty-target').selectOption('clear_nest');
  await page.getByTestId('bounty-nest').fill(String(nest));
  await page.getByTestId('bounty-reward').fill(String(BOUNTY_METALS));
  await page.getByTestId('bounty-expiry').fill('2');
  await page.getByTestId('bounty-post').click();
  const receipt = page.locator('[data-testid^="bounty-receipt-"]').first();
  await expect(receipt).toBeVisible({ timeout: 30_000 });
  await expect(receipt).toHaveAttribute('href', /\/dev\/chain\//);
  await expect(page.getByTestId('bounty-error')).toBeHidden();
  nestBountyId = bountyId(await receipt.getAttribute('data-testid'));
  await expect.poll(() => cargoMetals(page, AS_A), { timeout: 20_000 }).toBe(before - BOUNTY_METALS);
  expectNoPageErrors(page);
});

test('@hack 5. colony B claims and bounty.complete pays 200 metals once', async ({ browser }) => {
  serverOnly();
  test.setTimeout(180_000);
  const b = await seatB(browser);
  await openPlanetItem(b, 'bounties');
  const claim = b.getByTestId(`bounty-claim-${nestBountyId}`);
  await expect(claim).toBeVisible({ timeout: 20_000 });
  await claim.click();
  await expect(b.getByTestId(`bounty-state-${nestBountyId}`)).toHaveText('Claimed', { timeout: 20_000 });
  const before = await cargoMetals(b, AS_B);
  const paid = await devConsole(page, `bounty.complete ${nestBountyId}`, 60_000);
  expect(paid).toContain('paid');
  await expect.poll(() => cargoMetals(b, AS_B), { timeout: 20_000 }).toBe(before + BOUNTY_METALS);
  const again = await cargoMetals(b, AS_B);
  await devConsole(page, `bounty.complete ${nestBountyId}`, 60_000);
  expect(await cargoMetals(b, AS_B)).toBe(again);
  await openPlanetItem(page, 'bounties');
  await expect(page.getByTestId(`bounty-state-${nestBountyId}`)).toHaveText('Paid', { timeout: 20_000 });
  expectNoPageErrors(page);
  expectNoPageErrors(b);
});

test('6. Defend area for 2 h and merc.hire 2 opens escrow and spawns the squad', async () => {
  serverOnly();
  test.setTimeout(180_000);
  const before = await cargoMetals(page, AS_A);
  await openPlanetItem(page, 'bounties');
  await page.getByTestId('bounty-target').selectOption('defend_area');
  await page.getByTestId('bounty-q').fill('0');
  await page.getByTestId('bounty-r').fill('0');
  await page.getByTestId('bounty-radius').fill('2');
  await page.getByTestId('bounty-duration').fill('2');
  await page.getByTestId('bounty-reward').fill(String(BOUNTY_METALS));
  await page.getByTestId('bounty-expiry').fill('2');
  await page.getByTestId('bounty-post').click();
  const openRow = page.getByTestId('bounty-list-open').locator('[data-testid^="bounty-row-"]');
  await expect(openRow).toHaveCount(1, { timeout: 30_000 });
  defendBountyId = bountyId(await openRow.first().getAttribute('data-testid'));
  await expect.poll(() => cargoMetals(page, AS_A), { timeout: 20_000 }).toBe(before - BOUNTY_METALS);
  const hired = await devConsole(page, 'merc.hire 2', 60_000);
  expect(hired).toContain('escrow');
  expect(hired).toContain('merc-1.npc.terraagent.mock');
  mercBountyId = hired.match(/bounty (\S+)/)?.[1] ?? '';
  expect(mercBountyId).toMatch(/^bt_/);
  await expect.poll(() => mercCount(page), { timeout: 20_000 }).toBeGreaterThanOrEqual(4);
  await expect.poll(() => cargoMetals(page, AS_A), { timeout: 20_000 }).toBe(before - BOUNTY_METALS - HIRE_METALS);
  expectNoPageErrors(page);
});

test('7. bounty.expire refunds the player defend bounty once and does not refund the mercenary', async () => {
  serverOnly();
  test.setTimeout(240_000);
  await openPlanetItem(page, 'bounties');
  const before = await cargoMetals(page, AS_A);
  const expired = await devConsole(page, `bounty.expire ${defendBountyId}`, 60_000);
  expect(expired).toContain('Expired');
  expect(expired).toContain('refunded');
  await expect.poll(() => cargoMetals(page, AS_A), { timeout: 20_000 }).toBe(before + BOUNTY_METALS);
  const held = await cargoMetals(page, AS_A);
  const second = await devConsole(page, `bounty.expire ${defendBountyId}`, 60_000);
  expect(second).toContain('not refunded');
  expect(await cargoMetals(page, AS_A)).toBe(held);
  const skipped = await devConsole(page, `bounty.expire ${mercBountyId}`, 60_000);
  expect(skipped).toContain('mercenary');
  expect(await cargoMetals(page, AS_A)).toBe(held);
  await openPlanetItem(page, 'bounties');
  await expect(page.getByTestId(`bounty-state-${defendBountyId}`)).toHaveText('Expired', { timeout: 20_000 });
  await expect(page.getByTestId(`bounty-state-${mercBountyId}`)).toHaveText('Claimed');
  expectNoPageErrors(page);
});

test('@hack 8. waves=..21 hides Council and Bounties and treasury.fund is not sent', async () => {
  serverOnly();
  test.setTimeout(120_000);
  await page.goto(`/play.html?${new URLSearchParams({ scenario: 'w22', skip: '1', waves: '..21', as: 'w22off' })}`);
  await waitForTick(page, () => true, 90_000);
  await expect(page.getByTestId('planet-menu-council')).toHaveCount(0);
  await expect(page.getByTestId('planet-menu-bounties')).toHaveCount(0);
  const hidden = await devConsole(page, `treasury.fund ${planetId || 'pl_x'} 1`);
  expect(hidden).toContain('unknown command');
  expect(await devConsole(page, 'flags')).not.toContain('W22');
  expectNoPageErrors(page);
});

async function passProject(
  browser: import('@playwright/test').Browser,
  kind: 'meteor_shield' | 'terraform_boost',
  badge: string,
): Promise<void> {
  const b = await seatB(browser);
  await openPlanetItem(page, 'council');
  await page.getByTestId('council-kind').selectOption(kind);
  await page.getByTestId('council-propose').click();
  await voteYesOnOpen(page);
  await openPlanetItem(b, 'council');
  await voteYesOnOpen(b);
  await expect(page.getByTestId(badge)).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId(`effect-timer-${kind}`)).not.toHaveText('');
}

function bountyId(testid: string | null): string {
  const id = (testid ?? '').replace(/^bounty-(?:receipt|row|claim|state)-/, '');
  if (!id) throw new Error(`no bounty id in ${testid}`);
  return id;
}
