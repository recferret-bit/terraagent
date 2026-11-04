import type { BrowserContext, Page } from '@playwright/test';
import {
  devConsole,
  expect,
  expectNoPageErrors,
  hostMode,
  loadScenario,
  readTick,
  test,
} from './harness';

/**
 * W12 Player Page & Achievements — demo steps 1–10 (docs/plan/waves/W12-player-page-achievements.md).
 * Steps 1, 2, 3, 6, 7, 9, 10 are the hackathon slice (`npm run e2e -- --waves ..12 --hack`).
 * Steps 4 and 8 cover colony cards and badge/in-app delivery; full history (step 5) remains deferred.
 */
test.describe.configure({ mode: 'serial' });

const local = hostMode() === 'local';
const serverOnly = () => test.skip(local, 'needs the app (server host)');

let context: BrowserContext;
let playPage: Page;
let mePage: Page;

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  mePage = await context.newPage();
  playPage = await context.newPage();
});

test.afterAll(async () => {
  await context?.close();
});

async function tickAdvances(target: Page, from: number): Promise<void> {
  await expect
    .poll(async () => (await readTick(target)) ?? 0, { timeout: 15_000 })
    .toBeGreaterThan(from);
}

test('@hack 1. open /play.html?scenario=w12 and open /me.html in a second tab -> sticky section tabs', async () => {
  serverOnly();
  const t0 = await loadScenario(playPage, 'w12', {}, { as: 'w12', timeout: 45_000 });
  await expect(playPage.locator('[data-testid="hud-me-link"]')).toHaveCount(0);
  await tickAdvances(playPage, t0);

  await mePage.goto('/me.html?as=w12');
  await expect(mePage.locator('[data-testid="me-sticky-tabs"]')).toBeVisible({ timeout: 15_000 });
  const tabLabels = await mePage.locator('.ta-me-tab').allTextContents();
  expect(tabLabels).toEqual(['PILOT', 'PROGRESS', 'PLANETS', 'HISTORY', 'ACHIEVEMENTS', 'PLAY']);
  expectNoPageErrors(mePage);
});

test('@hack 2. Pilot section shows handle, Pilot ID, pilot since, Level 4, XP bar 1 120 / 1 500, and title Surveyor', async () => {
  serverOnly();
  await expect(mePage.locator('[data-testid="me-pilot-handle"]')).toHaveText('w12');
  await expect(mePage.locator('[data-testid="me-pilot-id"]')).toHaveText('w12.terraagent.mock');
  await expect(mePage.locator('[data-testid="me-pilot-since"]')).toContainText('Pilot since');
  await expect(mePage.locator('[data-testid="me-pilot-level"]')).toHaveText('Level 4');
  await expect(mePage.locator('[data-testid="me-pilot-xp-bar"]')).toHaveText('1 120 / 1 500');
  await expect(mePage.locator('[data-testid="me-pilot-title"]')).toHaveText('Surveyor');
});

test('@hack 3. Progress section lights S0..S4 stage track, shows 3 closest achievements with bars, and 16 stats tiles', async () => {
  serverOnly();
  for (let s = 0; s <= 10; s++) {
    const seg = mePage.locator(`[data-testid="me-stage-segment-${s}"]`);
    await expect(seg).toHaveAttribute('data-lit', s <= 4 ? 'true' : 'false');
  }
  await expect(mePage.locator('[data-testid="me-next-achievement"]')).toHaveCount(3);
  await expect(mePage.locator('.ta-stat-tile')).toHaveCount(16);
  await expect(mePage.locator('[data-testid="me-stat-resourcesProduced"]')).toContainText('24 500');
});

test('4. Planets section current & past colony cards', async () => {
  serverOnly();
  await expect(mePage.locator('[data-testid="me-current-colony"]')).toHaveCount(1);
  await expect(mePage.locator('[data-testid="me-past-colony"]')).toHaveCount(1);
  await expect(mePage.locator('[data-testid="me-colony-dive-in"]')).toHaveAttribute('href', '/play.html?scenario=w12&as=w12');
});

test('5. History timeline filter and infinite scroll', () => {
  test.skip(true, 'deferred to W12-10/11/18');
});

test('@hack 6. Achievements section shows 9 / 60 header, 20 family blocks × 3 cards, and PA-02 keyboard flip', async () => {
  serverOnly();
  await expect(mePage.locator('[data-testid="me-achievements-count"]')).toHaveText(
    'ACHIEVEMENTS · 9 / 60',
  );
  await expect(mePage.locator('.ta-ach-family-block')).toHaveCount(20);
  await expect(mePage.locator('.ta-ach-card')).toHaveCount(60);

  const firstCard = mePage.locator('[data-testid="ach-card-first-landfall"]');
  await expect(firstCard).toHaveAttribute('aria-expanded', 'false');
  await firstCard.focus();
  await mePage.keyboard.press('Enter');
  await expect(firstCard).toHaveAttribute('aria-expanded', 'true');
  await expect(firstCard).toHaveClass(/flip/);
});

test('@hack 7. Dev console fact add groundbreaker 900 unlocks Silver (+150 XP once) and toast appears; repeating adds no second XP', async () => {
  serverOnly();
  const out1 = await devConsole(playPage, 'fact add groundbreaker 900', 15_000);
  expect(out1).toContain('fact groundbreaker = 1700');
  expect(out1).toContain('Groundbreaker Silver (+150 XP)');
  await expect(playPage.locator('[data-testid="achievement-toast"]')).toContainText(
    'Groundbreaker · Silver (+150 XP)',
  );

  await mePage.reload();
  await expect(mePage.locator('[data-testid="me-achievements-count"]')).toHaveText(
    'ACHIEVEMENTS · 10 / 60',
  );
  await expect(mePage.locator('[data-testid="ach-card-groundbreaker-2"]')).toHaveAttribute(
    'data-status',
    'earned',
  );
  await expect(mePage.locator('[data-testid="me-pilot-xp-bar"]')).toHaveText('1 270 / 1 500');

  // Run the same command again -> Silver is already earned, Gold is 10 000, so no second XP is awarded
  const out2 = await devConsole(playPage, 'fact add groundbreaker 900', 15_000);
  expect(out2).toContain('fact groundbreaker = 2600');
  await mePage.reload();
  await expect(mePage.locator('[data-testid="me-pilot-xp-bar"]')).toHaveText('1 270 / 1 500');

  // Award XP via dev console to cross Level 5 threshold (1 500 XP)
  const out3 = await devConsole(playPage, 'xp add 1000', 15_000);
  expect(out3).toContain('2270 XP');
  await expect(playPage.locator('[data-testid="xp-level-up-toast"]')).toBeVisible();
});

test('8. Card back shows delivered mock badge and newly queued badge', async () => {
  serverOnly();
  await expect(mePage.locator('[data-testid="ach-card-first-landfall"]')).toContainText('Recorded (mock)');
  await expect(mePage.locator('[data-testid="ach-card-groundbreaker-2"]')).toContainText('Badge minting');
  await expect.poll(async () => {
    await mePage.reload();
    return mePage.locator('[data-testid="me-history-body"]').textContent();
  }).toContain('Groundbreaker');
});

test('@hack 9. Families whose producer wave is off under waves=..12 (Warlord, Diplomat, Merchant, Settler) show Coming soon', async () => {
  serverOnly();
  await mePage.goto('/me.html?as=w12&waves=..12');
  for (const id of ['warlord', 'diplomat', 'merchant', 'settler']) {
    const card = mePage.locator(`[data-testid="ach-card-${id}"]`);
    await expect(card).toHaveAttribute('data-status', 'coming_soon');
    await expect(card.locator('[data-testid="ach-coming-soon"]')).toHaveText('Coming soon');
    await expect(card.locator('[data-testid="ach-progress-bar"]')).toHaveCount(0);
  }
});

test('@hack 10. With waves=..11: no /me link in game HUD and /me.html shows Player page is off; game is unaffected', async () => {
  serverOnly();
  const t0 = await loadScenario(playPage, 'w12', { waves: '..11' }, { as: 'w12-off', timeout: 45_000 });
  await expect(playPage.locator('[data-testid="hud-me-link"]')).toHaveCount(0);
  await tickAdvances(playPage, t0);

  await mePage.goto('/me.html?waves=..11');
  await expect(mePage.locator('[data-testid="me-wave-disabled"]')).toContainText(
    'Player page is off',
    { timeout: 15_000 },
  );
});
