import {
  devConsole,
  expect,
  expectNoPageErrors,
  hostMode,
  loadLocal,
  loadScenario,
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
  expect(await devConsole(page, 'flags')).not.toContain('W16');
  await expect.poll(async () => (await readTick(page)) ?? 0, { timeout: 15_000 }).toBeGreaterThan(t0);
  expectNoPageErrors(page);
});
