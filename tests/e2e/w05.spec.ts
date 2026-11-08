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
import { E, ENTITY_STRIDE } from '../../frontend/game/store/replica/viewCodec';
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
  deposit: number;
}

async function readTileAt(page: Page, q: number, r: number): Promise<OnlineTileSnapshot | null> {
  return page.evaluate(([tq, tr]) => {
    const w = window as unknown as {
      __online?: {
        store?: {
          latestTiles?: { count: number; terrain: Uint8Array; prep: Uint8Array; deposit?: Uint8Array } | null;
          latest?: {
            planet?: { radius?: number };
            tiles?: { count: number; terrain: Uint8Array; prep: Uint8Array; deposit?: Uint8Array };
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
          return { terrain: tiles.terrain[idx] ?? 0, prep: tiles.prep[idx] ?? 0, deposit: tiles.deposit?.[idx] ?? 0 };
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

test('@hack 1 & 2. Load ?scenario=w05 (S4 colony, shallow lake & crater near Hub) -> order a Worker Drone T3 in Units menu -> it spawns', async ({ page }) => {
  await openScenario(page, 'w05');
  await expect(page.getByTestId('hud-terraform-val')).toHaveText('Terraform 0 / 412 (0.0 %)');

  // Step 1: check lake (6 shallow + 1 deep) and quarry slope + crater tiles near the Hub.
  expect(await readTileAt(page, -4, 1)).toMatchObject({ terrain: 5, prep: 1 }); // TERRAIN.shallow = 5
  expect(await readTileAt(page, -4, 2)).toMatchObject({ terrain: 6, prep: 1 }); // TERRAIN.deep = 6
  expect(await readTileAt(page, 4, 0)).toMatchObject({ terrain: 3, prep: 1 }); // TERRAIN.slope = 3
  expect(await readTileAt(page, 4, 1)).toMatchObject({ terrain: 4, prep: 1 }); // TERRAIN.hole = 4

  // Terraform menu has exactly three buttons: Terraform, Repair, Dismantle.
  await page.getByTestId('dock-tab-terraform').click();
  await expect(page.getByTestId('tf-op-terraform')).toBeVisible();
  await expect(page.getByTestId('tf-w05-ops')).toHaveCount(0);

  // Step 2: Units menu -> order a T3 Worker Drone -> it spawns.
  await devConsole(page, 'warp 20');
  await page.getByTestId('dock-tab-production').click();
  const beforeWorkers = (await getEntitiesSnapshot(page)).filter((e) => e.kind === KIND.worker).length;
  await page.getByTestId('prod-tier-t3').click();
  const tfCard = page.locator('[data-unit="worker"][data-tier="3"]');
  await expect(tfCard).toBeVisible();
  await tfCard.click();

  await expect.poll(
    async () => (await getEntitiesSnapshot(page)).filter((e) => e.kind === KIND.worker).length,
    { timeout: 25_000 },
  ).toBeGreaterThan(beforeWorkers);

  await devConsole(page, 'warp 1');
  await screenshot(page, '1-2-w05-worker-t3-spawned');
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

/** Moves a Worker Drone onto a Living meadow hex (one that did not turn into a deposit) and sees it arrive. */
async function expectWorkerReachesLivingHex(page: Page): Promise<void> {
  // At warp 20 one view spans ~20 ticks: an arrival followed by the walk back to a deposit (GP-99) can fall between views.
  await devConsole(page, 'warp 1');
  await closeConsole(page);
  const mover = (await getEntitiesSnapshot(page)).find((e) => e.kind === KIND.worker)!;
  // Changed ground uncovers buried deposits (D-44), so pick a Living meadow hex that did not turn into one.
  let target: readonly [number, number] | undefined;
  for (const [q, r] of W05_PREPARED_MEADOW_TILES) if ((await readTileAt(page, q, r))?.deposit === 0) { target = [q, r]; break; }
  expect(target, 'a Living meadow hex without a deposit').toBeTruthy();
  const [tq, tr] = target!;
  // An idle Worker Drone goes back to harvesting the tick after it arrives (GP-99), so watch every view for the arrival.
  await page.evaluate(({ id, tq, tr, E, S }) => {
    const w = window as unknown as { __online: { store: { onView(fn: (v: { count: number; entities: Float32Array }) => void): () => void } }; __moverAt?: boolean };
    w.__moverAt = false;
    const off = w.__online.store.onView((v) => {
      for (let i = 0; i < v.count; i++) {
        const o = i * S;
        if (v.entities[o + E.id] === id && v.entities[o + E.q] === tq && v.entities[o + E.r] === tr) { w.__moverAt = true; off(); }
      }
    });
  }, { id: mover.id, tq, tr, E, S: ENTITY_STRIDE });
  expect((await sendSimCmd(page, 'moveUnit', { entityId: mover.id, q: tq, r: tr })).ok).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __moverAt?: boolean }).__moverAt === true), { timeout: 15_000 }).toBe(true);
  expect(await readTileAt(page, tq, tr)).toMatchObject({ prep: 4 });
}

test('@hack 4 & 5. Ctrl+click Terraform reclaims the shallow lake to prepared ground; explicit irrigate -> seed makes the meadow Living (Terraform 10 / 412, 2.4 %)', async ({ page }) => {
  await openScenario(page, 'w05');
  await devConsole(page, 'warp 20');
  await closeConsole(page);

  // Order a Worker Drone T3 so the HQ and workers cover the area brushes together.
  expect((await sendSimCmd(page, 'enqueueTask', { taskId: 'u-tf-step4', task: { kind: 'buildUnit', unit: 'worker', tier: 3 } })).ok).toBe(true);

  // Step 4: one Terraform button; Ctrl+click queues each hex. First pass reclaims the 6 shallow-water tiles.
  await page.getByTestId('dock-tab-terraform').click();
  await page.getByTestId('tf-op-terraform').click();
  const ctrlClickAll = async (tiles: ReadonlyArray<readonly [number, number]>) => {
    await page.keyboard.down('Control');
    for (const [q, r] of tiles) await clickTile(page, q, r);
    await page.keyboard.up('Control');
  };
  await ctrlClickAll(W05_SHALLOW_LAKE_TILES);

  // One chain pass: shallow water becomes flat and prepared. The dock does not grade, irrigate or seed.
  await expect.poll(
    async () => {
      for (const [q, r] of W05_SHALLOW_LAKE_TILES) {
        const tile = await readTileAt(page, q, r);
        if (tile?.terrain !== 0 || tile?.prep !== 2) return false;
      }
      return true;
    },
    { timeout: 45_000 },
  ).toBe(true);
  await screenshot(page, '4-lake-reclaimed-and-graded');

  // The dock leaves prepared ground alone. Growth ops are still explicit orders; stop the chain so a worker can take them.
  for (const e of await getEntitiesSnapshot(page)) {
    if (e.kind === KIND.hq || e.kind === KIND.worker) {
      await sendSimCmd(page, 'cancelTask', { taskId: `unit:${e.id}` });
    }
  }
  const meadow = W05_PREPARED_MEADOW_TILES.map(([q, r]) => ({ q, r }));
  expect((await sendSimCmd(page, 'enqueueTask', { terraform: { op: 'irrigate', tiles: meadow } })).ok).toBe(true);
  await expect.poll(
    async () => {
      for (const [q, r] of W05_PREPARED_MEADOW_TILES) {
        if ((await readTileAt(page, q, r))?.prep !== 3) return false; // PREP.irrigated = 3
      }
      return true;
    },
    { timeout: 45_000 },
  ).toBe(true);

  expect((await sendSimCmd(page, 'enqueueTask', { terraform: { op: 'seed', tiles: meadow } })).ok).toBe(true);
  await expect.poll(
    async () => {
      for (const [q, r] of W05_PREPARED_MEADOW_TILES) {
        if ((await readTileAt(page, q, r))?.prep !== 4) return false; // PREP.living = 4
      }
      return true;
    },
    { timeout: 50_000 },
  ).toBe(true);

  // The TERRAFORM chain works on into the neighbouring deep hex (-4, 2) once a T2+ worker exists; a reclaimed deep
  // hex joins the eligible denominator (412 -> 413). Whether the chain got there before the cancel above is timing.
  const deepLeft = (await readTileAt(page, -4, 2))?.terrain === 6; // TERRAIN.deep = 6
  await expect(page.getByTestId('hud-terraform-val')).toHaveText(deepLeft ? 'Terraform 10 / 412 (2.4 %)' : 'Terraform 10 / 413 (2.4 %)');
  await expect(page.getByTestId('hud-terraform')).toHaveAttribute('data-living-hint', '+10 % ground move speed');

  // Press L -> Living mode of the tile-state overlay opens and shows the +10 % move speed hint.
  await closeConsole(page);
  await page.keyboard.press('l');
  const overlay = page.getByTestId('tf-tile-overlay');
  await expect(overlay).toBeVisible();
  await expect(overlay).toHaveAttribute('data-mode', 'living');
  await expect(page.getByTestId('tf-overlay-summary')).toContainText('LIVING 10');
  await expect(page.getByTestId('tf-overlay-summary')).toContainText('+10 % ground move speed');

  // Move a Worker Drone onto the Living meadow -> verify it traverses Living tiles at 1.1x speed.
  await expectWorkerReachesLivingHex(page);

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

test('@hack 14. DoD: ?waves=..04 hides W05 UI (Worker Drone T3 card, Terraform HUD meter; 3-button terraform tool) and W01 Grade / Clear / Break still works', async ({ page }) => {
  test.skip(local, 'local engine compiles scenario with its own wave flags');
  await openScenario(page, 'w05', { waves: '..04' });

  await expect(page.getByTestId('hud-terraform')).toBeHidden();
  await page.getByTestId('dock-tab-production').click();
  await expect(page.locator('[data-unit="worker"][data-tier="3"]')).toHaveCount(0);

  await page.getByTestId('dock-tab-terraform').click();
  // Only the W01 3-button toolset; W05 adds no separate op chips (the host picks each hex's op).
  expect(await page.getByTestId('terraform-menu').locator('[data-op]').evaluateAll((els) => els.map((e) => e.getAttribute('data-op')))).toEqual(['terraform', 'repair', 'dismantle']);
  await expect(page.getByTestId('tf-op-terraform')).toBeVisible();

  // The 3-button TERRAFORM still works with ?waves=..04: the crater hex (4, 1) is worked to Prepared flat ground.
  // (Level ground left at prep `flat`, like the scenario's (5, 1), counts as done for the dock: GP-93.)
  await devConsole(page, 'warp 20');
  await closeConsole(page);
  await page.getByTestId('tf-op-terraform').click();
  await clickTile(page, 4, 1);
  await expect.poll(async () => { const t = await readTileAt(page, 4, 1); return t ? `${t.terrain}/${t.prep}` : ''; }, { timeout: 20_000 }).toBe('0/2');

  await devConsole(page, 'warp 1');
  await screenshot(page, '14-waves-04-no-w05-ui');
  expectNoPageErrors(page);
});
