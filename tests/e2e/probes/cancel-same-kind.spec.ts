import type { Page } from '@playwright/test';
import { expect, hostMode, loadLocal, loadScenario, sendSimCmd, test } from '../harness';
import { W05_SHALLOW_LAKE_TILES } from '../../scenarios/w05-shape-the-land';

/**
 * Probe (not part of a wave suite): several queued terraform orders, one click on the Queue panel cancel ends all of
 * them (`cancelTask { scope: 'sameKind' }`), no target hexes are left. Run:
 * `E2E_HOST=local npx playwright test -c tests/e2e/playwright.config.ts tests/e2e/probes/cancel-same-kind.spec.ts`.
 */
test.describe.configure({ timeout: 120_000 });

type Order = { orderId: string; jobs: unknown[] };
const orders = (page: Page): Promise<Order[]> =>
  page.evaluate(() => {
    const raw = (window as unknown as { __online?: { store?: { latest?: { blobs?: Record<string, unknown> } | null } } }).__online?.store?.latest?.blobs?.terraformTasks as
      | { value?: { byColony?: Record<number, Order[]> }; byColony?: Record<number, Order[]> }
      | undefined;
    return (raw?.value?.byColony ?? raw?.byColony)?.[0] ?? [];
  });

test('three queued terraform orders: one Queue panel cancel click removes them all', async ({ page }) => {
  if (hostMode() === 'local') await loadLocal(page, 'w05', { shadow: '0', crt: '0', scale: '0.5', fps: '15' });
  else await loadScenario(page, 'w05', {}, { timeout: 60_000 });
  const tiles = W05_SHALLOW_LAKE_TILES.slice(0, 3);
  for (const [q, r] of tiles) {
    expect((await sendSimCmd(page, 'enqueueTask', { terraform: { op: 'reclaim', tiles: [{ q, r }] } })).ok).toBe(true);
  }
  await expect.poll(async () => (await orders(page)).length, { timeout: 15_000 }).toBe(3);
  const first = (await orders(page))[0]!.orderId;
  const btn = page.locator(`[data-cancel-task="${first}"]`);
  await expect(btn).toBeVisible({ timeout: 15_000 });
  await btn.click();
  await expect.poll(async () => (await orders(page)).length, { timeout: 15_000 }).toBe(0);
  await expect(page.locator('[data-cancel-task]')).toHaveCount(0);
});
