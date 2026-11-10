import {
  devConsole,
  expect,
  expectCleanHudLayout,
  expectNoPageErrors,
  hostMode,
  loadLocal,
  loadScenario,
  openColonyTab,
  openDockTab,
  readTick,
  test,
} from './harness';

/**
 * W16 Player-directed AI Strategy — the playable slice of the demo story
 * (`docs/plan/waves/W16-ai-director.md`).
 */
test.describe.configure({ mode: 'serial' });

const local = hostMode() === 'local';

async function openW16(page: Parameters<typeof loadScenario>[0], params: Record<string, string> = {}): Promise<number> {
  return local ? loadLocal(page, 'w16', params) : loadScenario(page, 'w16', params, { as: 'w16' });
}

test('1. scenario=w16 shows the DIRECTOR plate, live policy, risky comparison, and mock plan commands', async ({ page }) => {
  await openW16(page);
  const plate = page.locator('[data-panel=director-status]');
  await expect(plate).toBeHidden(); // in the Colony book's Director tab, which is not the first tab
  await openColonyTab(page, 'director');
  await expect(plate).toBeVisible();
  await expect(plate.locator('.ta-director__title')).toHaveText('DIRECTOR');
  await expect(plate.locator('[data-testid="director-policy-summary"]')).toContainText(
    'conservative · resources · 15% commit / 40% reserve',
  );
  await expect(plate.locator('.ta-director__row')).toHaveCount(0);
  expect(await devConsole(page, 'flags')).toContain('W16');
  expect(await devConsole(page, 'director.plan')).toContain(
    'plan forced trigger=resource.shortage risk=conservative queue=1 trace=mock',
  );
  await expect(plate.locator('.ta-director__row')).toHaveCount(1);
  expect(await devConsole(page, 'director.trace')).toContain('trace mock queue=1 outcome=proposed');

  // Switch risk to risky via HUD controls -> policy summary updates and old row is superseded
  await plate.locator('select[name="risk"]').selectOption('risky');
  await expect(plate.locator('[data-testid="director-policy-summary"]')).toContainText(
    'risky · resources · 35% commit / 15% reserve',
  );
  await expect(plate.locator('.ta-director__row').first()).toHaveAttribute('data-state', 'superseded');

  // Plan under risky profile -> 2 actions
  expect(await devConsole(page, 'director.plan')).toContain(
    'plan forced trigger=resource.shortage risk=risky queue=1 trace=mock',
  );
  await expect(plate.locator('.ta-director__row')).toHaveCount(2);

  // Raid fault is rejected with away_raids even under risky profile
  expect(await devConsole(page, 'director.plan raid_proposal')).toContain('outcome=unauthorized');
  await expect(plate.locator('.ta-director__row').first()).toHaveAttribute('data-state', 'rejected');
  await expect(plate.locator('.ta-director__row').first()).toContainText('away_raids');
  expectNoPageErrors(page);
});

test('2. waves=..15 hides the director plate and the tick keeps moving', async ({ page }) => {
  const t0 = await openW16(page, { waves: '..15' });
  await expect(page.locator('[data-panel=director-status]')).toHaveCount(0);
  await expect(page.getByTestId('colony-tab-director')).toHaveCount(0); // no empty Director tab either
  expect(await devConsole(page, 'flags')).not.toContain('W16');
  await expect.poll(async () => (await readTick(page)) ?? 0, { timeout: 15_000 }).toBeGreaterThan(t0);
  expectNoPageErrors(page);
});

test('3. tab-book HUD layout: the Colony book (left) and Command Dock (right) clear the pilot chip and top bar, and an open page sits on top of every other HUD plate, on every tab', async ({ page }) => {
  test.setTimeout(180_000); // every Colony tab (Player first) at two sizes
  // W16 boots every left-book tab but Deed (W20): Player, Goals, HQ AI, Director, Combat, Supply, Trade.
  await page.setViewportSize({ width: 1280, height: 720 });
  await openW16(page);
  const tabs = await page.locator('[data-testid^="colony-tab-"]').evaluateAll((els) =>
    els.map((el) => (el.getAttribute('data-testid') ?? '').replace('colony-tab-', '')));
  expect(tabs).toEqual(expect.arrayContaining(['goals', 'hq', 'director']));
  // The pilot chip (server-only identity feature) sits in the Colony book's PLAYER tab.
  // The pilot chip is in the PLAYER tab, so it is only on screen while that tab is open (not part of `required`).
  const required = ['leftBook', 'rightBook', 'minimap', 'bottomLeft', 'topCenter'];
  await openDockTab(page, 'build'); // the tallest dock pane
  for (const size of [{ width: 1280, height: 720 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(size);
    for (const tab of tabs) {
      await openColonyTab(page, tab);
      await expectCleanHudLayout(page, required, `colony tab ${tab}`);
    }
  }
  // A folded left book leaves only its tab column.
  await page.getByTestId('colony-book-toggle').click();
  await expect(page.getByTestId('colony-book')).toHaveAttribute('data-collapsed', 'true');
  await expectCleanHudLayout(page, required, 'colony book folded');
  expectNoPageErrors(page);
});
