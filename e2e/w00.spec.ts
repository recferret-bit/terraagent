import type { Page } from '@playwright/test';
import {
  CONSOLE, devConsole, expect, expectNoPageErrors, hostMode, loadLocal, loadScenario, readTick, screenshot, stack, test,
  ticksPerSecond, urls, waitForTick,
} from './harness';

/**
 * W00 Platform Skeleton — the wave's demo story (docs/plan/waves/W00-platform-skeleton.md) as one serial suite.
 * Steps tagged `@hack` are the Hackathon slice (`npm run e2e -- --waves ..00 --hack`). Step 4 (state inspector) is
 * H+ and not part of this landing; step 8 (CI green) is the CI workflow itself; `npm run test:parity` is step 10's
 * second half and runs as its own command.
 */
test.describe.configure({ mode: 'serial' });

const local = hostMode() === 'local';
const serverOnly = () => test.skip(local, 'needs the app (server host)');

interface Debug { __online: { store: { latest: { tick: number; count: number; entities: Float32Array; planet: { id: string } } | null }; terrain: unknown } }
const planetId = (page: Page) => page.evaluate(() => (window as unknown as Debug).__online.store.latest?.planet.id ?? null);
/** x of the first entity with the given id in the rendered view (stride 12: id, kind, owner, q, r, x, y, …). */
const entityX = (page: Page, id: number) => page.evaluate((eid) => {
  const v = (window as unknown as Debug).__online.store.latest;
  if (!v) return null;
  for (let i = 0; i < v.count; i++) if (v.entities[i * 12] === eid) return v.entities[i * 12 + 5];
  return null;
}, id);

/** Waits until the console output contains `pattern` (commands with mock-chain latency print late). */
async function consoleShows(page: Page, pattern: RegExp, timeout = 10_000): Promise<string> {
  let text = '';
  await expect.poll(async () => pattern.test((text = (await page.locator(CONSOLE.line).allTextContents()).join('\n'))), { timeout }).toBe(true);
  return pattern.exec(text)?.[0] ?? '';
}

async function expectRate(page: Page, lo: number, hi: number): Promise<number> {
  const rate = await ticksPerSecond(page, 3000);
  expect(rate, `ticks/s should be in [${lo}, ${hi}]`).toBeGreaterThan(lo);
  expect(rate).toBeLessThan(hi);
  return rate;
}

test('@hack 1. the stack is up: healthz 200, readyz {db: ok, simThreads 1+}', async ({ request }) => {
  serverOnly();
  expect((await request.get(`${urls().app}/v1/healthz`)).status()).toBe(200);
  const ready = await request.get(`${urls().app}/v1/readyz`);
  expect(ready.status()).toBe(200);
  const body = (await ready.json()) as { db: string; simThreads: number };
  expect(body.db).toBe('ok');
  expect(body.simThreads).toBeGreaterThanOrEqual(1);
});

test('@hack 2. ?scenario=w00 renders a flat hex planet and the tick rises about 5 per second', async ({ page }) => {
  serverOnly();
  await loadScenario(page, 'w00');
  await expect.poll(() => page.evaluate(() => Boolean((window as unknown as Debug).__online.terrain))).toBe(true);
  await expectRate(page, 3.5, 6.5);
  await screenshot(page, '2-hex-planet');
  expectNoPageErrors(page);
});

test('@hack 3. dev console warp 10 → about 50 ticks/s and a ×10 badge; warp 1 restores', async ({ page }) => {
  serverOnly();
  await loadScenario(page, 'w00');
  await devConsole(page, 'warp 10');
  await expect(page.locator('[data-testid=warp-badge]')).toHaveText(/×10/, { timeout: 5000 });
  await expectRate(page, 35, 65);
  await screenshot(page, '3-warp-10');
  await devConsole(page, 'warp 1');
  await expect(page.locator('[data-testid=warp-badge]')).toBeHidden({ timeout: 5000 });
  await expectRate(page, 3.5, 6.5);
});

test.fixme('4. state inspector: click a tile → its JSON (q, r, terrain, prep) — the inspector is H+ and lands later', async () => {});

test('@hack 5. flag panel: W00 on and every other wave listed; ?waves=..00 shows only W00 on', async ({ page }) => {
  serverOnly();
  await loadScenario(page, 'w00');
  const chips = page.locator('.ta-flags__chip');
  await expect(chips).toHaveCount(26);
  await expect(page.locator('.ta-flags__chip[data-on=true]')).toHaveCount(26);
  await loadScenario(page, 'w00', { waves: '..00' });
  await expect(page.locator('.ta-flags__chip[data-on=true]')).toHaveCount(1);
  await expect(page.locator('.ta-flags__chip[data-wave=W00]')).toHaveAttribute('data-on', 'true');
  await expect(page.locator('.ta-flags__chip[data-wave=W01]')).toHaveAttribute('data-on', 'false');
  await screenshot(page, '5-flags-00');
});

test('@hack 6. restarting the app shows Reconnecting…, then the tick continues from the snapshot, not 0', async ({ page }) => {
  serverOnly();
  await loadScenario(page, 'w00');
  const before = await waitForTick(page, 20);
  const id = await planetId(page);
  let sawBanner = false;
  const watch = (async () => {
    for (let i = 0; i < 240 && !sawBanner; i++) {
      const t = await page.locator('[data-testid=net-banner]').textContent().catch(() => null);
      if (t && /Reconnecting/.test(t) && (await page.locator('[data-testid=net-banner]').isVisible())) sawBanner = true;
      await page.waitForTimeout(100);
    }
  })();
  await stack.restartApp();
  await watch;
  expect(sawBanner, '"Reconnecting…" was shown').toBe(true);
  await expect(page.locator('[data-testid=net-banner]')).toBeHidden({ timeout: 30_000 });
  const after = await waitForTick(page, (t) => t >= before);
  expect(after).toBeGreaterThanOrEqual(before);
  expect(await planetId(page)).toBe(id);
  await screenshot(page, '6-after-restart');
});

test('@hack 7. chain.ping in the dev console → a mock: receipt appears in /dev/chain/', async ({ page, context }) => {
  serverOnly();
  const explorer = await context.newPage();
  await explorer.goto('/dev/chain/');
  await loadScenario(page, 'w00');
  const t0 = Date.now();
  await devConsole(page, 'chain.ping');
  const hash = await consoleShows(page, /mock:[1-9A-HJ-NP-Za-km-z]{20,}/);
  const ms = Date.now() - t0;
  expect(ms, 'mock latency 300–1 500 ms (+ console overhead)').toBeGreaterThan(250);
  await expect(explorer.getByText(hash).first()).toBeVisible({ timeout: 5000 });
  await screenshot(explorer, '7-chain-explorer');
});

test('@hack 9. with the app stopped, ?host=local runs the planet in the browser; warp 10 works; a reload resumes', async ({ page }) => {
  test.setTimeout(120_000);
  if (!local) await stack.stopApp();
  try {
    await loadLocal(page, 'w00');
    await expect(page.locator('[data-testid=net-banner]')).toBeHidden();
    await expectRate(page, 3.5, 6.5);
    await devConsole(page, 'warp 10');
    await expectRate(page, 35, 65);
    await devConsole(page, 'warp 1');
    const before = (await readTick(page)) ?? 0;
    await page.waitForTimeout(11_000); // the local host saves to IndexedDB every 10 s (and on pagehide)
    const saved = (await readTick(page)) ?? 0;
    await page.reload();
    const resumed = await waitForTick(page, () => true, 30_000);
    expect(resumed, `resumed at ${resumed}, was ${saved}`).toBeGreaterThanOrEqual(before);
    await screenshot(page, '9-local-host');
    expectNoPageErrors(page);
  } finally {
    if (!local) await stack.startApp();
  }
});

test('@hack 10. ?lag=300: nudge moves the test entity on the next frame; after the ack prediction and server agree', async ({ page }) => {
  serverOnly();
  await loadScenario(page, 'w00', { lag: '300' });
  await expect.poll(() => entityX(page, 1), { timeout: 10_000 }).not.toBeNull();
  const x0 = (await entityX(page, 1)) as number;
  await page.keyboard.press('Backquote');
  await page.locator(CONSOLE.input).fill('nudge 1');
  const movedAfterMs = await page.evaluate(async ([x]) => {
    const view = () => (window as unknown as Debug).__online.store.latest;
    const xOf = () => { const v = view(); if (!v) return x; for (let i = 0; i < v.count; i++) if (v.entities[i * 12] === 1) return v.entities[i * 12 + 5]; return x; };
    const input = document.querySelector<HTMLInputElement>('[data-testid=dev-console] input')!;
    const t0 = performance.now();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    while (performance.now() - t0 < 2000) {
      if (xOf() !== x) return performance.now() - t0;
      await new Promise((r) => requestAnimationFrame(r));
    }
    return -1;
  }, [x0] as const);
  console.log(`[w00] predicted nudge visible after ${movedAfterMs.toFixed(1)} ms (lag 300 ms each way)`);
  expect(movedAfterMs, 'predicted move visible').toBeGreaterThanOrEqual(0);
  expect(movedAfterMs, 'within a few frames, not after the ~600 ms round trip').toBeLessThan(200);
  await consoleShows(page, /dev\.nudge ok, applied at tick \d+/, 5000);
  await page.waitForTimeout(1500); // the covering delta arrives; nothing pending
  expect(Math.abs(((await entityX(page, 1)) as number) - (x0 + 1)), 'predicted vs confirmed position (tiles)').toBeLessThan(0.05);
  await screenshot(page, '10-prediction');
});
