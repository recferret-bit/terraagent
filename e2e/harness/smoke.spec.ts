import { expect, test } from '@playwright/test';
import { clickTile, devConsole, expectNoPageErrors, hostMode, loadLocal, loadScenario, screenshot, ticksPerSecond, urls } from './index';

// Harness smoke suite: proves boot, helpers and the --hack filter. Real wave suites are e2e/wNN.spec.ts.
const serverOnly = hostMode() === 'local';

test.describe('harness smoke', () => {
  test('@hack local host: planet renders from the browser engine, tick ~5/s, warp 10, no app', async ({ page }) => {
    await loadLocal(page, 'w00');
    const rate = await ticksPerSecond(page, 3000);
    expect(rate).toBeGreaterThan(3.5);
    expect(rate).toBeLessThan(6.5);
    await expect(page.locator('[data-testid=net-banner]')).toBeHidden();
    await screenshot(page, 'local-host');
    expect(await devConsole(page, 'chain.ping')).toContain('host_unavailable');
    await devConsole(page, 'warp 10');
    const warped = await ticksPerSecond(page, 3000);
    expect(warped).toBeGreaterThan(35);
    expect(warped).toBeLessThan(65);
    await devConsole(page, 'warp 1');
    expectNoPageErrors(page);
  });

  test('@hack healthz/readyz', async ({ request }) => {
    test.skip(serverOnly, 'server-only step');
    const base = urls().app;
    expect((await request.get(`${base}/v1/healthz`)).ok()).toBe(true);
    const ready = await request.get(`${base}/v1/readyz`);
    expect(ready.status()).toBe(200);
    const body = JSON.stringify(await ready.json());
    expect(body).toMatch(/"db":"ok"/);
    expect(Number(/"simThreads":(\d+)/.exec(body)?.[1] ?? 0)).toBeGreaterThanOrEqual(1);
  });

  test('@hack play page renders a hex planet and the tick rises ~5/s', async ({ page }) => {
    test.skip(serverOnly, 'server-only step');
    await loadScenario(page, 'w00');
    const rate = await ticksPerSecond(page, 3000);
    expect(rate).toBeGreaterThan(3.5);
    expect(rate).toBeLessThan(6.5);
    await screenshot(page, 'play-hex-planet');
    expectNoPageErrors(page);
  });

  test('pick a tile', async ({ page }) => {
    test.skip(serverOnly, 'server-only step');
    await loadScenario(page, 'w00');
    const pick = await clickTile(page, 0, 0);
    expect(pick).toMatchObject({ q: 0, r: 0 });
    await screenshot(page, 'picked-tile');
  });
});
