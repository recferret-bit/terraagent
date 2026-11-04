import type { Page } from '@playwright/test';
import {
  clickTile,
  devConsole,
  expect,
  expectNoPageErrors,
  getColony0,
  getEntitiesSnapshot,
  hostMode,
  KIND,
  loadLocal,
  loadScenario,
  screenshot,
  sendSimCmd,
  STATE_CONSTRUCTING,
  test,
} from './harness';
import { W05_PREPARED_MEADOW_TILES, W05_SHALLOW_LAKE_TILES } from '../scenarios/w05-shape-the-land';

/**
 * W05 Shape the Land — Wave E2E suite covering the hackathon demo story (`docs/plan/waves/W05-shape-the-land.md` §2 steps
 * 1–5, 11, 13) and Wave DoD (`?waves=..04` isolation).
 * Tagged `@hack` so both `npm run e2e -- --waves ..05` and `npm run e2e -- --waves ..05 --hack` run them.
 */
test.describe.configure({ mode: 'serial', timeout: 120_000 });

const local = hostMode() === 'local';

async function openScenario(page: Page, id: string, params: Record<string, string> = {}): Promise<void> {
  if (local) {
    await loadLocal(page, id, params, 60_000);
  } else {
    await loadScenario(page, id, params, { timeout: 60_000 });
  }
}

interface OnlineTileSnapshot {
  terrain: number;
  prep: number;
}

async function readTileAt(page: Page, q: number, r: number): Promise<OnlineTileSnapshot | null> {
  return page.evaluate(([tq, tr]) => {
    const w = window as unknown as {
      __online?: {
        store?: {
          latestTiles?: { count: number; terrain: Uint8Array; prep: Uint8Array } | null;
          latest?: {
            planet?: { radius?: number };
            tiles?: { count: number; terrain: Uint8Array; prep: Uint8Array };
          } | null;
        };
      };
    };
    const latest = w.__online?.store?.latest;
    const tiles = w.__online?.store?.latestTiles ?? latest?.tiles;
    const R = latest?.planet?.radius ?? 16;
    if (!tiles || Math.max(Math.abs(tq), Math.abs(tr), Math.abs(tq + tr)) > R) return null;
    let idx = 0;
    for (let rr = -R; rr <= R; rr++) {
      const qMin = Math.max(-R, -rr - R);
      const qMax = Math.min(R, -rr + R);
      for (let qq = qMin; qq <= qMax; qq++) {
        if (qq === tq && rr === tr) {
          return { terrain: tiles.terrain[idx] ?? 0, prep: tiles.prep[idx] ?? 0 };
        }
        idx++;
      }
    }
    return null;
  }, [q, r] as const);
}

async function closeConsole(page: Page): Promise<void> {
  const input = page.locator('[data-testid=dev-console] input');
  if (await input.isVisible().catch(() => false)) {
    await page.keyboard.press('Backquote');
    await input.waitFor({ state: 'hidden', timeout: 5_000 });
  }
}

test('@hack 1 & 2. Load ?scenario=w05 (S4 colony, shallow lake & crater near Hub) -> order a Terraformer in Units menu -> Terraformer Drone spawns', async ({ page }) => {
  await openScenario(page, 'w05');
  await expect(page.getByTestId('hud-terraform-val')).toHaveText('Terraform 0 / 412 (0.0 %)');

  // Step 1: check lake (6 shallow + 1 deep) and quarry slope + crater tiles near the Hub.
  expect(await readTileAt(page, -4, 1)).toMatchObject({ terrain: 5, prep: 1 }); // TERRAIN.shallow = 5
  expect(await readTileAt(page, -4, 2)).toMatchObject({ terrain: 6, prep: 1 }); // TERRAIN.deep = 6
  expect(await readTileAt(page, 4, 0)).toMatchObject({ terrain: 3, prep: 1 }); // TERRAIN.slope = 3
  expect(await readTileAt(page, 4, 1)).toMatchObject({ terrain: 4, prep: 1 }); // TERRAIN.hole = 4

  // Terraform menu lists the W05 ops and locks Deep Reclaim with "needs T2 worker".
  await page.getByTestId('dock-tab-terraform').click();
  await expect(page.getByTestId('tf-w05-ops')).toBeVisible();
  for (const op of ['level', 'fill', 'reclaim', 'deepReclaim', 'irrigate', 'seed']) {
    await expect(page.getByTestId(`tf-op-${op}`)).toBeVisible();
  }
  await expect(page.getByTestId('tf-op-deepReclaim')).toBeDisabled();
  await expect(page.getByTestId('tf-op-deepReclaim')).toContainText('needs T2 worker');

  // Step 2: Units menu -> order a Terraformer -> it spawns.
  await devConsole(page, 'warp 20');
  await page.getByTestId('dock-tab-production').click();
  const tfCard = page.locator('[data-unit="terraformer"]');
  await expect(tfCard).toBeVisible();
  await page.locator('[data-queue-unit="terraformer"]').click();

  await expect.poll(
    async () => (await getEntitiesSnapshot(page)).some((e) => e.kind === KIND.terraformer),
    { timeout: 25_000 },
  ).toBe(true);

  await devConsole(page, 'warp 1');
  await screenshot(page, '1-2-w05-terraformer-spawned');
  expectNoPageErrors(page);
});

test('@hack 3. Construction menu -> place a Resource Extractor (Quarry) on the slope + crater footprint (4, 0) -> ghost shows prep bill (Level x2, Fill x1, Grade x4) -> confirm -> waiting(site: 0/4 tiles prepared) -> linked prep runs -> Extractor builds at 4/4', async ({ page }) => {
  await openScenario(page, 'w05');
  await expect(page.locator('[data-testid="command-dock"]')).toHaveAttribute('data-active-tab', 'build');
  await page.locator('.ta-construction__card[data-building="metalsExtractor"]').click();

  const pos = await page.evaluate(() =>
    (window as unknown as { __online: { tileToScreen(q: number, r: number): { x: number; y: number } | null } }).__online.tileToScreen(4, 0),
  );
  expect(pos).toBeTruthy();
  await page.mouse.move(pos!.x, pos!.y);

  const ghost = page.locator('.ta-placement-ghost[data-building="metalsExtractor"]');
  await expect(ghost).toBeVisible();
  await expect(ghost).toHaveAttribute('data-valid', 'true');
  await expect(ghost).toHaveAttribute('data-deposit-covered', 'true');
  const prepText = ghost.locator('.ta-placement-ghost__prep');
  await expect(prepText).toContainText('Level ×2');
  await expect(prepText).toContainText('Fill ×1');
  await expect(prepText).toContainText('Grade ×4');
  await expect(prepText).toContainText('300 E');
  await expect(prepText).toContainText('38s');
  await expect(prepText).toContainText('10 Metals');
  await expect(prepText).toContainText('9 Minerals');
  await screenshot(page, '3-quarry-ghost-prep-bill');

  // Confirm placement -> construction waits on site prep (0/4) while the linked terraform order runs.
  await ghost.locator('.ta-placement-ghost__confirm').click();
  await page.getByTestId('dock-tab-queue').click();

  const quarryChip = page.locator('.ta-queue-chip', { hasText: /Resource Extractor|Minerals Quarry/ });
  await expect(quarryChip).toBeVisible();
  await expect(quarryChip).toContainText(/waiting\(site: \d\/4 tiles prepared\)|waiting: site/);

  await devConsole(page, 'warp 20');
  await expect.poll(
    async () =>
      (await getEntitiesSnapshot(page)).some(
        (e) =>
          (e.kind === KIND.metalsExtractor || e.kind === KIND.mineralsQuarry) &&
          e.q === 4 &&
          e.r === 0 &&
          e.state !== STATE_CONSTRUCTING,
      ),
    { timeout: 35_000 },
  ).toBe(true);

  for (const [q, r] of [[4, 0], [5, 0], [4, 1], [5, 1]] as const) {
    expect(await readTileAt(page, q, r)).toMatchObject({ terrain: 0, prep: 2 }); // TERRAIN.flat = 0, PREP.prepared = 2
  }

  await devConsole(page, 'warp 1');
  await screenshot(page, '3-quarry-completed-after-linked-prep');
  expectNoPageErrors(page);
});

test('@hack 4 & 5. Brush Reclaim -> Grade over 6 shallow-water tiles, then brush Irrigate -> Seed over 10 Prepared tiles -> HUD shows Terraform 10 / 412 (2.4 %) and units on Living move 10 % faster', async ({ page }) => {
  await openScenario(page, 'w05');
  await devConsole(page, 'warp 20');
  await closeConsole(page);

  // Order a Terraformer so HQ + Builder + Terraformer work the area brushes in parallel.
  expect((await sendSimCmd(page, 'enqueueTask', { taskId: 'u-tf-step4', task: { kind: 'buildUnit', unit: 'terraformer' } })).ok).toBe(true);

  // Step 4: Brush Reclaim (Hex r=1) at (-4, 1) over the 6 shallow-water tiles.
  await page.getByTestId('dock-tab-terraform').click();
  await page.getByTestId('tf-brush-hex-1').click();
  await page.getByTestId('tf-op-reclaim').click();
  await clickTile(page, -4, 1);

  await expect.poll(
    async () => {
      for (const [q, r] of W05_SHALLOW_LAKE_TILES) {
        if ((await readTileAt(page, q, r))?.terrain !== 0) return false;
      }
      return true;
    },
    { timeout: 45_000 },
  ).toBe(true);

  // Grade the 6 reclaimed Flat tiles -> Prepared.
  await page.getByTestId('tf-op-grade').click();
  await clickTile(page, -4, 1);
  await expect.poll(
    async () => {
      for (const [q, r] of W05_SHALLOW_LAKE_TILES) {
        if ((await readTileAt(page, q, r))?.prep !== 2) return false;
      }
      return true;
    },
    { timeout: 35_000 },
  ).toBe(true);
  await screenshot(page, '4-lake-reclaimed-and-graded');

  // Step 5: Brush Irrigate (Hex r=2) at (1, 4) over the 10 Prepared meadow tiles, then Seed them to Living.
  await page.getByTestId('tf-brush-hex-2').click();
  await page.getByTestId('tf-op-irrigate').click();
  await clickTile(page, 1, 4);

  await expect.poll(
    async () => {
      for (const [q, r] of W05_PREPARED_MEADOW_TILES) {
        if ((await readTileAt(page, q, r))?.prep !== 3) return false; // PREP.irrigated = 3
      }
      return true;
    },
    { timeout: 45_000 },
  ).toBe(true);

  await page.getByTestId('tf-op-seed').click();
  await clickTile(page, 1, 4);

  await expect.poll(
    async () => {
      for (const [q, r] of W05_PREPARED_MEADOW_TILES) {
        if ((await readTileAt(page, q, r))?.prep !== 4) return false; // PREP.living = 4
      }
      return true;
    },
    { timeout: 50_000 },
  ).toBe(true);

  await expect(page.getByTestId('hud-terraform-val')).toHaveText('Terraform 10 / 412 (2.4 %)');
  await expect(page.getByTestId('hud-terraform')).toHaveAttribute('data-living-hint', '+10 % ground move speed');

  // Press L -> Living mode of the tile-state overlay opens and shows the +10 % move speed hint.
  await closeConsole(page);
  await page.keyboard.press('l');
  const overlay = page.getByTestId('tf-tile-overlay');
  await expect(overlay).toBeVisible();
  await expect(overlay).toHaveAttribute('data-mode', 'living');
  await expect(page.getByTestId('tf-overlay-summary')).toContainText('LIVING 10');
  await expect(page.getByTestId('tf-overlay-summary')).toContainText('+10 % ground move speed');

  // Move the Builder Drone onto the Living meadow -> verify it traverses Living tiles at 1.1x speed.
  const builder = (await getEntitiesSnapshot(page)).find((e) => e.kind === KIND.builder)!;
  expect((await sendSimCmd(page, 'moveUnit', { entityId: builder.id, q: 1, r: 4 })).ok).toBe(true);
  await expect.poll(
    async () => {
      const b = (await getEntitiesSnapshot(page)).find((e) => e.id === builder.id);
      return b ? b.q === 1 && b.r === 4 : false;
    },
    { timeout: 15_000 },
  ).toBe(true);
  expect(await readTileAt(page, 1, 4)).toMatchObject({ prep: 4 });

  await devConsole(page, 'warp 1');
  await screenshot(page, '5-living-meadow-2.4-percent');
  expectNoPageErrors(page);
});

test('@hack 11. Queue a terraform order, then run time night -> terraform ops pause first (waiting(power), progress kept) and resume at time day', async ({ page }) => {
  await openScenario(page, 'w05');

  // Queue Reclaim on the 6 shallow lake tiles and wait until the first job is partially in progress.
  expect(
    (
      await sendSimCmd(page, 'enqueueTask', {
        terraform: { op: 'reclaim', tiles: W05_SHALLOW_LAKE_TILES.map(([q, r]) => ({ q, r })) },
      })
    ).ok,
  ).toBe(true);

  const readFirstJob = () =>
    page.evaluate(() => {
      const w = window as unknown as {
        __online?: {
          store?: {
            latest?: {
              blobs?: {
                terraformTasks?: {
                  value?: { byColony?: Record<number, Array<{ status?: string; waitReason?: string; jobs: Array<{ progress: number; status?: string; waitReason?: string }> }>> };
                  byColony?: Record<number, Array<{ status?: string; waitReason?: string; jobs: Array<{ progress: number; status?: string; waitReason?: string }> }>>;
                };
              };
            } | null;
          };
        };
      };
      const raw = w.__online?.store?.latest?.blobs?.terraformTasks;
      const order = (raw?.value?.byColony ?? raw?.byColony)?.[0]?.[0];
      const job = order?.jobs?.[0];
      if (!order || !job) return null;
      return {
        progress: job.progress,
        status: order.status ?? job.status,
        waitReason: order.waitReason ?? job.waitReason,
      };
    });

  await expect.poll(async () => (await readFirstJob())?.progress ?? 0, { timeout: 20_000 }).toBeGreaterThan(0.05);

  // Switch to night -> solar drops to 0, group-1 brownout shedding pauses the terraform op first (`waiting(power)`).
  await devConsole(page, 'time night');
  await closeConsole(page);
  await expect.poll(async () => (await getColony0(page))?.power?.phase ?? 'day', { timeout: 10_000 }).toBe('night');
  await expect.poll(async () => (await getColony0(page))?.power?.shedGroupsActive ?? [], { timeout: 10_000 }).toContain(1);
  await expect.poll(async () => (await readFirstJob())?.waitReason ?? '', { timeout: 10_000 }).toBe('power');

  const pausedProgress = (await readFirstJob())!.progress;
  expect(pausedProgress).toBeGreaterThan(0);
  expect(pausedProgress).toBeLessThan(1);

  await page.getByTestId('dock-tab-terraform').click();
  await expect(page.getByTestId('tf-status')).toContainText('waiting(power)');
  await page.getByTestId('dock-tab-queue').click();
  await expect(page.locator('.ta-queue-chip', { hasText: 'Terraform: reclaim' })).toContainText('waiting(power)');
  await screenshot(page, '11-night-terraform-waiting-power');

  // Switch back to day -> the terraform op resumes from its preserved progress.
  await devConsole(page, 'time day');
  await expect.poll(async () => (await getColony0(page))?.power?.phase ?? 'night', { timeout: 10_000 }).toBe('day');
  await expect.poll(async () => (await readFirstJob())?.waitReason ?? '', { timeout: 10_000 }).toBe('');
  await expect.poll(async () => (await readFirstJob())?.progress ?? 0, { timeout: 15_000 }).toBeGreaterThan(pausedProgress + 0.05);

  await screenshot(page, '11-day-terraform-resumed');
  expectNoPageErrors(page);
});

test('@hack 13. Open ?scenario=w05-tiers (Terraform 31 %, ringed Metals Extractor at (3, 0)) -> Metals chip shows metals.t2 income (30 % split); second Extractor at (-5, 0) stays T1 only', async ({ page }) => {
  await openScenario(page, 'w05-tiers');
  await expect(page.getByTestId('hud-terraform-val')).toHaveText('Terraform 123 / 397 (31.0 %)');

  // Hover Metals chip -> tier breakdown shows metals.t2 unlocked with positive income (+0.3/s = 30 % of 1.05/s).
  const metalsChip = page.getByTestId('hud-stock-metals');
  await metalsChip.hover();
  const t2Row = metalsChip.locator('[data-res="metals.t2"]');
  await expect(t2Row).toHaveAttribute('data-locked', 'false');
  await expect(t2Row.locator('.ta-res-breakdown__rate')).toHaveText('+0.3/s');
  await expect.poll(async () => (await getColony0(page))?.stock?.['metals.t2'] ?? 0, { timeout: 15_000 }).toBeGreaterThan(0);

  // Click ringed Metals Extractor at (3, 0) -> shows 70 % metals.t1 / 30 % metals.t2.
  await clickTile(page, 3, 0);
  const tierBadge = page.getByTestId('hq-extractor-tier');
  await expect(tierBadge).toBeVisible();
  await expect(tierBadge).toContainText('70 % metals.t1 / 30 % metals.t2');
  await expect(tierBadge).toHaveAttribute('data-unlocked-tier', '2');
  await screenshot(page, '13-ringed-extractor-t2-active');

  // Click second Metals Extractor at (-5, 0) on unterraformed ground -> stays 100 % metals.t1.
  await clickTile(page, -5, 0);
  await expect(tierBadge).toBeVisible();
  await expect(tierBadge).toContainText('100 % metals.t1');
  await expect(tierBadge).toHaveAttribute('data-unlocked-tier', '1');
  await screenshot(page, '13-unterraformed-extractor-t1-only');
  expectNoPageErrors(page);
});

test('@hack 14. DoD: ?waves=..04 hides W05 UI (Terraformer unit card, W05 terraform op chips, Terraform HUD meter) and W01 Grade / Clear / Break still works', async ({ page }) => {
  test.skip(local, 'local engine compiles scenario with its own wave flags');
  await openScenario(page, 'w05', { waves: '..04' });

  await expect(page.getByTestId('hud-terraform')).toBeHidden();
  await page.getByTestId('dock-tab-production').click();
  await expect(page.locator('[data-unit="terraformer"]')).toHaveCount(0);

  await page.getByTestId('dock-tab-terraform').click();
  await expect(page.getByTestId('tf-w05-ops')).toBeHidden();
  await expect(page.getByTestId('tf-op-terraform')).toBeVisible();

  // W01 Grade still works on a flat tile with ?waves=..04.
  await devConsole(page, 'warp 20');
  await closeConsole(page);
  await page.getByTestId('tf-op-terraform').click();
  await clickTile(page, 5, 1);
  await expect.poll(async () => (await readTileAt(page, 5, 1))?.prep ?? 0, { timeout: 20_000 }).toBe(2);

  await devConsole(page, 'warp 1');
  await screenshot(page, '14-waves-04-no-w05-ui');
  expectNoPageErrors(page);
});
