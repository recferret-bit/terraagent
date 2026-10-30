import { expect, test } from '@playwright/test';
import { clickTile, expectNoPageErrors, loadScenario, screenshot, ticksPerSecond, urls } from './index';

// Harness smoke suite: proves boot, helpers and the --hack filter. Real wave suites are e2e/wNN.spec.ts.
test.describe('harness smoke', () => {
  test('@hack healthz/readyz', async ({ request }) => {
    const base = urls().app;
    expect((await request.get(`${base}/v1/healthz`)).ok()).toBe(true);
    const ready = await request.get(`${base}/v1/readyz`);
    expect(ready.status()).toBe(200);
    const body = JSON.stringify(await ready.json());
    expect(body).toMatch(/"db":"ok"/);
    expect(Number(/"simThreads":(\d+)/.exec(body)?.[1] ?? 0)).toBeGreaterThanOrEqual(1);
  });

  test('@hack play page renders a hex planet and the tick rises ~5/s', async ({ page }) => {
    await loadScenario(page, 'w00');
    const rate = await ticksPerSecond(page, 3000);
    expect(rate).toBeGreaterThan(3.5);
    expect(rate).toBeLessThan(6.5);
    await screenshot(page, 'play-hex-planet');
    expectNoPageErrors(page);
  });

  test('pick a tile', async ({ page }) => {
    await loadScenario(page, 'w00');
    const pick = await clickTile(page, 0, 0);
    expect(pick).toMatchObject({ q: 0, r: 0 });
    await screenshot(page, 'picked-tile');
  });
});
