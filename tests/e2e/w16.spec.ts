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
 * (`docs/plan/waves/W16-ai-director.md`). The plate is the DIRECTOR title.
 * Goals, sliders, budget and rationale are not painted during play (AI-13).
 */
test.describe.configure({ mode: 'serial' });

const local = hostMode() === 'local';

async function openW16(page: Parameters<typeof loadScenario>[0], params: Record<string, string> = {}): Promise<number> {
  return local ? loadLocal(page, 'w16', params) : loadScenario(page, 'w16', params, { as: 'w16' });
}

test('1. scenario=w16 shows the DIRECTOR plate and the mock plan commands', async ({ page }) => {
  await openW16(page);
  const plate = page.locator('[data-panel=director-status]');
  await expect(plate.locator('.ta-director__title')).toHaveText('DIRECTOR');
  await expect(plate.locator('.ta-director__row')).toHaveCount(0);
  await expect(page.locator('.ta-flags__chip[data-wave=W16]')).toHaveAttribute('data-on', 'true');
  expect(await devConsole(page, 'director.plan')).toContain(
    'plan forced trigger=resource.shortage risk=conservative queue=1 trace=mock',
  );
  expect(await devConsole(page, 'director.trace')).toContain('trace mock queue=1 outcome=proposed');
  expectNoPageErrors(page);
});

test('2. waves=..15 hides the director plate and the tick keeps moving', async ({ page }) => {
  const t0 = await openW16(page, { waves: '..15' });
  await expect(page.locator('[data-panel=director-status]')).toHaveCount(0);
  await expect(page.locator('.ta-flags__chip[data-wave=W16]')).toHaveAttribute('data-on', 'false');
  await expect.poll(async () => (await readTick(page)) ?? 0, { timeout: 15_000 }).toBeGreaterThan(t0);
  expectNoPageErrors(page);
});
