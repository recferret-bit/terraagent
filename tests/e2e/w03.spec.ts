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

/**
 * W03 The Grid — Wave E2E suite covering the demo story (`docs/plan/waves/W03-the-grid.md`) and DoD: power zones
 * (Protoss-style placement), the HQ cell as the night store, brownout and pylon overload, repair, storage wait /
 * earmarks, unit supply and builder dismantle.
 * Tagged `@hack` so both `npm run e2e -- --waves ..03` and `npm run e2e -- --waves ..03 --hack` run them.
 */
test.describe.configure({ mode: 'serial', timeout: 120_000 });

const local = hostMode() === 'local';

async function openW03(page: Page, params: Record<string, string> = {}): Promise<void> {
  if (local) {
    await loadLocal(page, 'w03', params, 60_000);
  } else {
    await loadScenario(page, 'w03', params, { timeout: 60_000 });
  }
}

/** The power zone highlight of the construction ghost (`PowerZoneOverlay3D`, three.js group `power-zone-overlay`). */
const zoneOverlayVisible = (page: Page) =>
  page.evaluate(() => {
    const o = (window as unknown as { __online: { viewport: { scene: { getObjectByName(n: string): { visible: boolean } | undefined } } } }).__online;
    return o.viewport.scene.getObjectByName('power-zone-overlay')?.visible ?? null;
  });

/** Builds one building through the queue (`enqueueTask` build order) and expects the host to accept it. */
async function orderBuild(page: Page, taskId: string, building: string, q: number, r: number): Promise<void> {
  const ack = await sendSimCmd(page, 'enqueueTask', { taskId, task: { kind: 'build', building, q, r } });
  expect(ack, `${building} at (${q}, ${r})`).toMatchObject({ ok: true });
}

/** Waits for the first finished (not under construction) entity of `kind` at `(q, r)` (any tile when omitted); returns its id. */
async function finishedEntity(page: Page, kind: number, at?: { q: number; r: number }, timeout = 25_000): Promise<number> {
  let id = 0;
  await expect.poll(async () => {
    const e = (await getEntitiesSnapshot(page)).find((x) => x.kind === kind && x.state !== STATE_CONSTRUCTING && (!at || (x.q === at.q && x.r === at.r)));
    id = e?.id ?? 0;
    return id > 0;
  }, { timeout }).toBe(true);
  return id;
}

const powerOf = async (page: Page, id: number) => {
  const p = (await getColony0(page))?.power;
  return p?.entityPower?.[String(id)];
};

test('@hack 1 & 2. Load ?scenario=w03 (Hub, Extractor, Solar, 2 Harvesters; day supply 29 / demand 19, supply 2 / 10) -> order 1 Builder at Hub -> Builder appears and Construction runs in parallel', async ({ page }) => {
  await openW03(page);
  await expect.poll(async () => (await getColony0(page))?.stock?.['metals.t1'] ?? 0).toBeGreaterThanOrEqual(400);
  const col = await getColony0(page);
  // Founder core +16, Solar T1 net +13 = 29; Hub 7 + Extractor 8 + 2 Harvesters 2 each = 19.
  // Workers briefly draw less while walking to their first harvesting targets.
  await expect.poll(async () => (await getColony0(page))?.power).toMatchObject({ supply: 29, demand: 19, net: 10, founderCorePerS: 16, solarNetPerS: 13, phase: 'day', brownout: false });
  expect(col?.power?.hqCellStoredE).toBe(800);
  expect(col?.supply).toMatchObject({ used: 2, units: 2, cap: 10 });
  await expect(page.locator('[data-testid="hud-supply"] .ta-hud-min__stock-val')).toHaveText('2 / 10');
  await expect(page.locator('[data-testid="hud-supply"]')).toHaveAttribute('data-level', 'ok');

  const initialEnts = await getEntitiesSnapshot(page);
  expect(initialEnts.filter((e) => e.kind === KIND.harvester).length).toBe(2);

  await devConsole(page, 'warp 20');
  const ack = await sendSimCmd(page, 'enqueueTask', { taskId: 'u-builder-1', task: { kind: 'buildUnit', unit: 'builder' } });
  expect(ack.ok).toBe(true);
  await expect.poll(async () => (await getEntitiesSnapshot(page)).some((e) => e.kind === KIND.builder), { timeout: 20_000 }).toBe(true);

  // Two constructions in parallel (HQ + Builder), both inside the Hub's power zone (radius 6).
  await orderBuild(page, 'b-pylon-p1', 'pylon', 4, -2);
  await orderBuild(page, 'b-pylon-p2', 'pylon', -4, -2);
  await expect.poll(async () => (await getEntitiesSnapshot(page)).filter((e) => e.kind === KIND.pylon && e.state === 5).length, { timeout: 20_000 }).toBe(2); // ENTITY_STATE.active = 5

  await devConsole(page, 'warp 1');
  await screenshot(page, '1-2-w03-builder-and-parallel-build');
  expectNoPageErrors(page);
});

test('@hack 3 & 4. Power zones: an armed card shows the zone; a far Resource Extractor is outside_power_zone; queued Pylons extend the zone -> the Resource Extractor runs online; lose the bridging pylon -> offline: no grid', async ({ page }) => {
  await openW03(page);
  await expect.poll(async () => (await getColony0(page))?.stock?.['metals.t1'] ?? 0).toBeGreaterThanOrEqual(400);

  // Step 3: arming a building card shows the colony's power zone in blue; Escape hides it again.
  expect(await zoneOverlayVisible(page)).toBe(false);
  await expect(page.locator('[data-testid="command-dock"]')).toHaveAttribute('data-active-tab', 'build'); // the Build tab opens first
  await page.locator('.ta-construction__card[data-building="pylon"]').click();
  await expect(page.locator('.ta-construction__card[data-building="pylon"]')).toHaveAttribute('data-selected', 'true');
  await expect.poll(() => zoneOverlayVisible(page)).toBe(true);
  await screenshot(page, '3-power-zone-armed');
  await page.keyboard.press('Escape');
  await expect.poll(() => zoneOverlayVisible(page)).toBe(false);

  await devConsole(page, 'warp 20');
  await devConsole(page, 'fill metals.t1 500');
  await devConsole(page, 'fill minerals.t1 500');

  // The far minerals deposit (10, 0) lies outside the Hub's zone: the host rejects it, and a Solar at (9, 0) too.
  for (const [building, q] of [['metalsExtractor', 10], ['solar', 9]] as const) {
    const ack = await sendSimCmd(page, 'enqueueTask', { taskId: `b-out-${building}`, task: { kind: 'build', building, q, r: 0 } });
    expect(ack).toMatchObject({ ok: false, code: 'outside_power_zone' });
  }

  // Pylons one by one toward the deposit, back to back: a queued pylon already extends the zone for the next order.
  await orderBuild(page, 'b-pylon-e1', 'pylon', 3, -1);
  await orderBuild(page, 'b-pylon-e2', 'pylon', 6, -1);
  await orderBuild(page, 'b-pylon-e3', 'pylon', 9, -1);
  // Step 4: the Resource Extractor on the far deposit, inside the last pylon's zone.
  await orderBuild(page, 'b-quarry-far', 'metalsExtractor', 10, 0);

  const quarryId = await finishedEntity(page, KIND.metalsExtractor, { q: 10, r: 0 }, 40_000);
  await expect.poll(async () => (await powerOf(page, quarryId))?.state ?? '', { timeout: 20_000 }).toBe('online');
  expect((await powerOf(page, quarryId))?.component).toBe(0); // the Hub's component

  // Lose the bridging pylon (6, -1): the Resource Extractor's branch is cut from the Hub.
  const bridge = (await getEntitiesSnapshot(page)).find((e) => e.kind === KIND.pylon && e.q === 6 && e.r === -1);
  expect(bridge, 'bridging pylon at (6, -1)').toBeTruthy();
  await devConsole(page, `damage ${bridge!.id} 100`);
  await expect.poll(async () => (await powerOf(page, quarryId))?.reason ?? '', { timeout: 15_000 }).toBe('offline: no grid');
  expect((await powerOf(page, quarryId))?.component).not.toBe(0);

  await devConsole(page, 'warp 1');
  await screenshot(page, '3-4-pylons-quarry-no-grid');
  expectNoPageErrors(page);
});

test('@hack 5 & 7. Supply Depot (cap 500 -> 1500, supply cap 10 -> 18), Wind & Capacitor, wind holds at night, and pylon overload (> 80 E/s)', async ({ page }) => {
  await openW03(page);
  await devConsole(page, 'warp 20');
  await devConsole(page, 'fill metals.t1 500');
  await devConsole(page, 'fill minerals.t1 500');
  await devConsole(page, 'fill bio.biomass 500');
  await devConsole(page, 'fill bio.water 500');

  // Step 5: Supply Depot, Wind Turbine and Capacitor Bank.
  await orderBuild(page, 'b-depot', 'supplyDepot', -3, -3);
  await orderBuild(page, 'b-wind', 'wind', 0, -4);
  await orderBuild(page, 'b-cap', 'capacitor', 3, -3);

  await expect.poll(async () => (await getColony0(page))?.caps?.metals ?? 500, { timeout: 25_000 }).toBe(1500);
  await expect.poll(async () => (await getColony0(page))?.supply?.cap ?? 10, { timeout: 25_000 }).toBe(18); // a powered Depot adds +8
  await expect.poll(async () => (await getColony0(page))?.power?.windNetPerS ?? 0, { timeout: 25_000 }).toBeGreaterThan(0);
  await expect.poll(async () => (await getColony0(page))?.power?.capacitorStoredE ?? 0, { timeout: 25_000 }).toBeGreaterThan(0);

  // Step 7: a Pylon at (5, -1) and a Water Extractor at (7, -1) on that pylon's branch, then overload it (> 80 E/s).
  await devConsole(page, 'fill metals.t1 1000');
  await devConsole(page, 'fill minerals.t1 1000');
  await orderBuild(page, 'b-pylon-branch', 'pylon', 5, -1);
  await orderBuild(page, 'b-water-branch', 'waterExtractor', 7, -1);
  const branchPylonId = await finishedEntity(page, KIND.pylon, { q: 5, r: -1 });
  const branchWaterId = await finishedEntity(page, KIND.waterExtractor, { q: 7, r: -1 });

  await devConsole(page, 'addLoad 85');
  await expect.poll(async () => (await getColony0(page))?.power?.pylonLoads?.[String(branchPylonId)]?.overloaded ?? false, { timeout: 10_000 }).toBe(true);
  await expect.poll(async () => (await powerOf(page, branchWaterId))?.reason ?? '', { timeout: 10_000 }).toBe('offline: overload');
  await screenshot(page, '7-pylon-overload');

  // Clear the load; at night the Solar gives nothing (minus its 1 E/s drain) and the Wind still turns.
  await devConsole(page, 'addLoad 0');
  await devConsole(page, 'time night');
  await expect.poll(async () => (await getColony0(page))?.power?.phase ?? 'day', { timeout: 10_000 }).toBe('night');
  const nightPwr = (await getColony0(page))?.power;
  expect(nightPwr?.solarNetPerS ?? 99).toBeLessThanOrEqual(0);
  expect(nightPwr?.windNetPerS ?? 0).toBeGreaterThan(0);

  await devConsole(page, 'warp 1');
  await screenshot(page, '5-7-depot-wind-capacitor-overload');
  expectNoPageErrors(page);
});

test('@hack 6. time night: the HQ cell carries the start colony (no brownout, Stored draining); addLoad 200 -> brownout sheds', async ({ page }) => {
  await openW03(page);
  await expect.poll(async () => (await getColony0(page))?.power?.hqCellStoredE ?? 0).toBe(800);

  await devConsole(page, 'time night');
  await expect.poll(async () => (await getColony0(page))?.power?.phase ?? 'day', { timeout: 10_000 }).toBe('night');
  // Night: founder core 16 against demand 19 -> the cell covers the 3 E/s deficit, nothing is shed.
  await expect.poll(async () => (await getColony0(page))?.power?.hqCellDischargePerS ?? 0, { timeout: 10_000 }).toBe(3);
  const start = (await getColony0(page))?.power?.hqCellStoredE ?? 0;
  await expect.poll(async () => (await getColony0(page))?.power?.hqCellStoredE ?? start, { timeout: 15_000 }).toBeLessThan(start - 5);
  const night = (await getColony0(page))?.power;
  expect(night?.brownout).toBe(false);
  expect(night?.solarNetPerS).toBe(-1);
  expect(Object.values(night?.offlineReasons ?? {})).not.toContain('offline: brownout');
  await expect(page.locator('.ta-power-hud__brownout[data-brownout="true"]')).toHaveCount(0);

  const energy = page.locator('[data-testid="hud-hq-cell"]');
  await energy.hover();
  await expect(energy.locator('[data-testid="res-income-energy"]')).toHaveText('Income (Supply): +16 E/s');
  await expect(energy.locator('[data-testid="res-spending-energy"]')).toHaveText('Spending (Demand): −19 E/s');
  await expect(energy.locator('[data-testid="res-net-energy"]')).toHaveText('Net: −3 E/s');
  await expect(energy.locator('[data-testid="res-stored-energy"]')).toHaveText('Stored: −3 E/s (draining)');
  await screenshot(page, '6-night-cell-draining');

  // A deficit beyond the cell's 30 E/s discharge cap browns out and sheds.
  await devConsole(page, 'addLoad 200');
  await expect.poll(async () => (await getColony0(page))?.power?.brownout ?? false, { timeout: 10_000 }).toBe(true);
  await expect(page.locator('.ta-power-hud__brownout[data-brownout="true"]')).toBeVisible();
  await expect(page.locator('.ta-power-hud__brownout')).toContainText('BROWNOUT');
  expect(Object.values((await getColony0(page))?.power?.offlineReasons ?? {})).toContain('offline: brownout');
  expect((await getColony0(page))?.power?.hqCellDischargePerS).toBe(30);

  await devConsole(page, 'addLoad 0');
  await screenshot(page, '6-addload-brownout');
  expectNoPageErrors(page);
});

test('@hack 8. Select building (#id in selection panel), run damage <entity> 60 -> auto-queued repair job and Builder repairs it at 1.5x', async ({ page }) => {
  await openW03(page);
  await devConsole(page, 'warp 20');

  // Order a Builder Drone so it repairs at 1.5x
  expect((await sendSimCmd(page, 'enqueueTask', { taskId: 'u-bld-rep', task: { kind: 'buildUnit', unit: 'builder' } })).ok).toBe(true);
  await expect.poll(async () => (await getEntitiesSnapshot(page)).some((e) => e.kind === KIND.builder), { timeout: 20_000 }).toBe(true);

  const extractor = (await getEntitiesSnapshot(page)).find((e) => e.kind === KIND.metalsExtractor)!; // at (3, 0)
  expect(extractor).toBeTruthy();

  await clickTile(page, extractor.q, extractor.r);
  await expect(page.locator('[data-testid="selection-entity-id"]')).toHaveText(`#${extractor.id}`);

  // Damage the Extractor by 60% (drops to 40% HP = 200/500, critical -> auto-queues system repair)
  await devConsole(page, `damage ${extractor.id} 60`);

  await expect.poll(async () => (await getEntitiesSnapshot(page)).find((e) => e.id === extractor.id)?.hp ?? 0, { timeout: 20_000 }).toBe(500);

  await devConsole(page, 'warp 1');
  await screenshot(page, '8-building-repaired');
  expectNoPageErrors(page);
});

test('@hack 9 & 10. Storage wait ("Build Depot" button opens placement ghost) and 60s resource-starved earmark in Queue panel v2', async ({ page }) => {
  await openW03(page);
  await page.locator('[data-testid="dock-tab-queue"]').click();
  await expect(page.locator('[data-testid="queue-lane-tabs"]')).toBeVisible();

  // Step 9: Storage wait when order cost > 500 cap (server host uses tune)
  if (!local) {
    await devConsole(page, `tune economyT1Basic.solar.cost '{"metals.t1":600,"minerals.t1":75,"bio.biomass":10,"bio.water":5}'`);
    try {
      await sendSimCmd(page, 'enqueueTask', { taskId: 'b-storage-w03', task: { kind: 'build', building: 'solar', q: 5, r: -4 } });
      await expect.poll(async () => ((await getColony0(page))?.queue ?? []).find((e) => e.taskId === 'b-storage-w03')?.waitReason ?? '', { timeout: 15_000 }).toBe('storage');
      const hintBtn = page.locator('[data-task-id="b-storage-w03"] [data-testid="queue-storage-hint"]');
      await expect(hintBtn).toBeVisible();
      await expect(hintBtn).toContainText('Build Supply Depot');
      await hintBtn.click();
      await expect(page.locator('.ta-construction__card[data-building="supplyDepot"]')).toHaveAttribute('data-selected', 'true');
      await expect(page.locator('.ta-placement-ghost[data-building="supplyDepot"]')).toBeVisible();
      expect((await sendSimCmd(page, 'cancelTask', { taskId: 'b-storage-w03' })).ok).toBe(true);
    } finally {
      await devConsole(page, 'tune reset');
    }
  }

  // Step 10: Resource-starved item earmarks after 60s of game time and HUD shows the earmark bar
  await devConsole(page, 'fill bio.water 0');
  await expect.poll(async () => (await getColony0(page))?.stock?.['bio.water'] ?? 200).toBe(0);

  expect((await sendSimCmd(page, 'enqueueTask', { taskId: 'b-starved-solar', task: { kind: 'build', building: 'solar', q: 5, r: -4 } })).ok).toBe(true);

  await devConsole(page, 'warp 20');
  await expect.poll(async () => {
    const col = await getColony0(page);
    const entry = col?.queue?.find((e) => e.taskId === 'b-starved-solar');
    return entry?.earmarked?.['bio.water'] ?? col?.earmarks?.['bio.water'] ?? 0;
  }, { timeout: 25_000 }).toBeGreaterThan(0);

  if (await page.locator('[data-testid="command-dock"]').getAttribute('data-active-tab') !== 'queue') {
    await page.locator('[data-testid="dock-tab-queue"]').click();
  }
  await expect(page.locator('[data-testid="queue-earmark-bar"]')).toBeVisible();
  await expect(page.locator('[data-testid="queue-earmark-bar"]')).toContainText('Earmarked:');
  await expect(page.locator('[data-testid="queue-earmark-bar"]')).toContainText('Water');

  await devConsole(page, 'warp 1');
  await screenshot(page, '9-10-storage-wait-and-earmark');
  expectNoPageErrors(page);
});

test('@hack 11. Unit supply: 2 / 10 at start -> Harvesters fill it to 10 / 10 (full: QUEUE disabled, supply_cap reject, Depot hint) -> a powered Supply Depot raises the cap to 18', async ({ page }) => {
  await openW03(page);
  const header = page.locator('[data-testid="hud-supply"]');
  await expect(header.locator('.ta-hud-min__stock-val')).toHaveText('2 / 10');
  await expect(header).toHaveAttribute('data-level', 'ok');

  await devConsole(page, 'warp 20');
  for (const res of ['metals.t1', 'minerals.t1', 'bio.biomass', 'bio.water']) await devConsole(page, `fill ${res} 500`);
  // 9 Harvester orders: the first 8 fill the cap (2 + 8 = 10), the 9th waits on supply.
  for (let i = 1; i <= 9; i++) {
    expect((await sendSimCmd(page, 'enqueueTask', { taskId: `u-harv-${i}`, task: { kind: 'buildUnit', unit: 'harvester' } })).ok).toBe(true);
  }
  await expect.poll(async () => (await getColony0(page))?.supply?.units ?? 0, { timeout: 40_000 }).toBe(10);
  await devConsole(page, 'warp 1');
  await expect(header.locator('.ta-hud-min__stock-val')).toHaveText('10 / 10');
  await expect(header).toHaveAttribute('data-level', 'full');
  await expect.poll(async () => ((await getColony0(page))?.queue ?? []).find((e) => e.taskId === 'u-harv-9')?.waitReason ?? '').toBe('supply');

  // Units menu: QUEUE greyed with the reason; the host rejects a direct order with supply_cap.
  await page.locator('[data-testid="dock-tab-production"]').click();
  await expect(page.locator('[data-queue-unit="harvester"]')).toBeDisabled();
  await expect(page.locator('[data-unit="harvester"] [data-supply-reason]')).toBeVisible();
  await expect(page.locator('[data-unit="harvester"] [data-supply-reason]')).toContainText('Supply Depot');
  expect(await sendSimCmd(page, 'enqueueTask', { taskId: 'u-harv-over', task: { kind: 'buildUnit', unit: 'harvester' } })).toMatchObject({ ok: false, code: 'supply_cap' });
  await page.locator('[data-testid="dock-tab-queue"]').click();
  await expect(page.locator('[data-task-id="u-harv-9"] [data-testid="queue-supply-hint"]')).toBeVisible();
  await header.hover();
  await expect(page.locator('[data-testid="res-breakdown-supply"]')).toContainText('Used 10 / cap 10');
  await screenshot(page, '11-supply-full');

  // A Supply Depot, built and powered, adds +8: the waiting Harvester starts.
  await devConsole(page, 'warp 20');
  await orderBuild(page, 'b-depot-supply', 'supplyDepot', -3, -3);
  await expect.poll(async () => (await getColony0(page))?.supply?.cap ?? 0, { timeout: 30_000 }).toBe(18);
  await expect.poll(async () => ((await getColony0(page))?.queue ?? []).find((e) => e.taskId === 'u-harv-9')?.waitReason ?? 'gone').not.toBe('supply');
  await devConsole(page, 'warp 1');
  await expect(header.locator('.ta-hud-min__stock-val')).toHaveText(/^1[01] \/ 18$/);
  await expect(header).toHaveAttribute('data-level', 'ok');
  await screenshot(page, '11-supply-depot-cap-18');
  expectNoPageErrors(page);
});

test('@hack 12. Dismantle [Z] on the Solar #3: a Builder walks there, "Dismantling n%" in the queue, 50% refunded step by step, the Solar is removed', async ({ page }) => {
  await openW03(page);
  await devConsole(page, 'warp 20');
  expect((await sendSimCmd(page, 'enqueueTask', { taskId: 'u-bld-dis', task: { kind: 'buildUnit', unit: 'builder' } })).ok).toBe(true);
  await expect.poll(async () => (await getEntitiesSnapshot(page)).some((e) => e.kind === KIND.builder), { timeout: 20_000 }).toBe(true);
  await devConsole(page, 'warp 1');
  // Bio has no income here: the Solar's refund (Biomass 10 -> +5, Water 5 -> +2.5) shows exactly, well under the cap.
  await devConsole(page, 'fill bio.biomass 100');
  await devConsole(page, 'fill bio.water 100');
  await expect.poll(async () => (await getColony0(page))?.stock?.['bio.water'] ?? 0).toBe(100);
  await page.keyboard.press('Backquote'); // close the console so Z reaches the dock

  const solar = (await getEntitiesSnapshot(page)).find((e) => e.kind === KIND.solar);
  expect(solar, 'the scenario Solar').toMatchObject({ id: 3, q: -3, r: 2 });

  await page.locator('[data-testid="dock-tab-terraform"]').click();
  await page.keyboard.press('z');
  await expect(page.locator('[data-testid="terraform-menu"]')).toHaveAttribute('data-armed', 'true');
  expect(await clickTile(page, -3, 2)).toMatchObject({ q: -3, r: 2 });
  await expect(page.locator('[data-testid="tf-status"]')).toContainText('DISMANTLE');

  await page.locator('[data-testid="dock-tab-queue"]').click();
  const chip = page.locator('[data-task-id]', { hasText: 'Dismantle Solar Array' });
  await expect(chip).toBeVisible();
  // A second dismantle order on the same building is refused.
  expect(await sendSimCmd(page, 'enqueueTask', { taskId: 'dis-again', task: { kind: 'terraform', op: 'dismantle', q: -3, r: 2 } })).toMatchObject({ ok: false, code: 'already_dismantling' });
  await expect(chip).toContainText(/Dismantling \d+%/, { timeout: 20_000 }); // the Builder arrived and works
  await screenshot(page, '12-dismantling');

  // Refund step by step: Biomass passes a value strictly between 100 and 105 before the Solar is gone.
  let sawStep = false;
  await expect.poll(async () => {
    const bio = (await getColony0(page))?.stock?.['bio.biomass'] ?? 0;
    if (bio > 100 && bio < 105) sawStep = true;
    return (await getEntitiesSnapshot(page)).some((e) => e.id === 3);
  }, { timeout: 30_000, intervals: [200] }).toBe(false);
  expect(sawStep, 'a partial refund before the end').toBe(true);
  const col = await getColony0(page);
  const stock = col?.stock ?? {};
  // Whole-unit stock (W13-41, LED-23): the 50 % refund of 5 water is 2 whole + 0.5 in `residual` (millionths).
  const exact = (k: string): number => (stock[k] ?? 0) + (col?.residual?.[k] ?? 0) / 1_000_000;
  expect(exact('bio.biomass')).toBeCloseTo(105, 5);
  expect(exact('bio.water')).toBeCloseTo(102.5, 5);
  await expect(chip).toHaveCount(0);
  await screenshot(page, '12-dismantled');
  expectNoPageErrors(page);
});

test('@hack 13. DoD: ?waves=..02 hides W03 UI (queue lane tabs, W03 building cards, Builder unit card)', async ({ page }) => {
  test.skip(local, 'local engine compiles scenario with its own wave flags');
  await openW03(page, { waves: '..02' });
  await expect(page.locator('[data-testid="queue-lane-tabs"]')).toHaveCount(0);
  await expect(page.locator('[data-building="pylon"]')).toHaveCount(0);
  await expect(page.locator('[data-building="supplyDepot"]')).toHaveCount(0);
  await expect(page.locator('[data-building="mineralsQuarry"]')).toHaveCount(0);
  await screenshot(page, '13-waves-02-no-w03-ui');
  expectNoPageErrors(page);
});
