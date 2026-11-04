import type { Page } from '@playwright/test';
import {
  clickTile,
  devConsole,
  expect,
  expectNoPageErrors,
  getColony0,
  getEntitiesSnapshot,
  hostMode,
  loadLocal,
  loadScenario,
  screenshot,
  sendSimCmd,
  STATE_CONSTRUCTING,
  test,
} from './harness';

/**
 * W07 First Contact — Wave E2E suite covering demo steps 1–10 (`docs/plan/waves/W07-first-contact.md` §1 & W07-32)
 * and the `waves=..06` flag gate. Steps 1–9 are tagged `@hack`.
 */
test.describe.configure({ mode: 'serial', timeout: 150_000 });

const local = hostMode() === 'local';

const W07_KIND = {
  roboticsFactory: 17,
  droneControlArray: 18,
  autocannon: 19,
  laserTower: 20,
  recon: 51,
  demoTank: 52,
  demoArtillery: 53,
  blackAnt: 60,
  blueBeetle: 61,
  greenSpitter: 62,
  hiveBlackAnt: 63,
  hiveBlueBeetle: 64,
  hiveGreenSpitter: 65,
} as const;

async function openW07(page: Page, params: Record<string, string> = {}, scenario = 'w07'): Promise<void> {
  const merged = { shadow: '0', crt: '0', wind: '0', ...params };
  if (local) {
    await loadLocal(page, scenario, merged, 60_000);
  } else {
    await loadScenario(page, scenario, merged, { timeout: 60_000 });
  }
}

async function orderBuild(page: Page, taskId: string, building: string, q: number, r: number): Promise<void> {
  const ack = await sendSimCmd(page, 'enqueueTask', { taskId, task: { kind: 'build', building, q, r } });
  expect(ack, `${building} at (${q}, ${r})`).toMatchObject({ ok: true });
}

async function waitForFinishedBuilding(page: Page, kind: number, q: number, r: number, timeout = 30_000): Promise<number> {
  let id = 0;
  await expect.poll(async () => {
    const e = (await getEntitiesSnapshot(page)).find((x) => x.kind === kind && x.state !== STATE_CONSTRUCTING && x.q === q && x.r === r);
    id = e?.id ?? 0;
    return id > 0;
  }, { timeout }).toBe(true);
  return id;
}

const getRingMeshCount = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const o = (window as unknown as {
      __online?: { viewport?: { scene?: { getObjectByName(n: string): { visible: boolean; count?: number } | undefined } } };
    }).__online;
    const mesh = o?.viewport?.scene?.getObjectByName('instanced-range-rings');
    return mesh && mesh.visible ? (mesh.count ?? 0) : 0;
  });

const getTilePrepAt = (page: Page, q: number, r: number): Promise<number | null> =>
  page.evaluate(([tq, tr]) => {
    const o = (window as unknown as {
      __online?: {
        store?: {
          latest?: { planet?: { radius?: number } } | null;
          latestTiles?: { prep: Uint8Array } | null;
        };
      };
    }).__online;
    const R = o?.store?.latest?.planet?.radius;
    const tiles = o?.store?.latestTiles;
    if (!R || !tiles) return null;
    let i = 0;
    for (let rr = -R; rr <= R; rr++) {
      for (let qq = Math.max(-R, -rr - R); qq <= Math.min(R, -rr + R); qq++, i++) {
        if (qq === tq && rr === tr) return tiles.prep[i] ?? null;
      }
    }
    return null;
  }, [q, r] as const);

test('@hack 1. Load ?scenario=w07 (S3 colony, 3 passive species hives >= 30 tiles away, neutral coexistence) + playground hive-life scene', async ({ page }) => {
  await openW07(page);
  await expect.poll(async () => (await getColony0(page))?.supply?.used ?? 0).toBe(7);
  const col = await getColony0(page);
  expect(col?.supply).toMatchObject({ used: 7, units: 7, cap: 10 });
  expect(col?.power?.brownout).toBe(false);

  const ents = await getEntitiesSnapshot(page);
  const antHive = ents.find((e) => e.kind === W07_KIND.hiveBlackAnt);
  const beetleHive = ents.find((e) => e.kind === W07_KIND.hiveBlueBeetle);
  const spitterHive = ents.find((e) => e.kind === W07_KIND.hiveGreenSpitter);
  expect(antHive).toBeTruthy();
  expect(beetleHive).toBeTruthy();
  expect(spitterHive).toBeTruthy();

  const bugs = ents.filter((e) => e.kind === W07_KIND.blackAnt || e.kind === W07_KIND.blueBeetle || e.kind === W07_KIND.greenSpitter);
  expect(bugs.length).toBeGreaterThanOrEqual(10);

  // Step ticks with warp 10: passive bugs wander around their hives and neither side auto-attacks.
  await devConsole(page, 'warp 10');
  await page.waitForTimeout(600);
  await devConsole(page, 'warp 1');
  const afterEnts = await getEntitiesSnapshot(page);
  expect(afterEnts.filter((e) => e.hp < e.hpMax)).toHaveLength(0);
  await screenshot(page, '1-w07-passive-hives');

  // Inspect playground hive-life scene (`?faunaScene=mixed`).
  await page.goto('/playground.html?faunaScene=mixed&faunaSeed=7');
  await expect(page.locator('[data-testid="pg-fauna-panel"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-fauna-stats] .fp-hive-row')).toHaveCount(3);
  await screenshot(page, '1b-playground-hive-life');
  expectNoPageErrors(page);
});

test('@hack 2 & 3. Build Robotics Factory T1 -> Army section -> order 3 Recon to rally (10/10 supply) -> 4th Recon rejected supply_cap -> build DCA (+8 cap -> 18) -> 4th Recon proceeds', async ({ page }) => {
  await openW07(page);
  await devConsole(page, 'warp 20');
  for (const [res, amt] of [['metals.t1', 500], ['minerals.t1', 500], ['bio.biomass', 250], ['bio.water', 250]] as const) {
    await devConsole(page, `fill ${res} ${amt}`);
  }

  // Step 2: Build Robotics Factory T1 at (4, -3).
  await expect(page.locator('.ta-construction__card[data-building="roboticsFactory"]')).toBeVisible();
  await orderBuild(page, 'b-factory-1', 'roboticsFactory', 4, -3);
  await waitForFinishedBuilding(page, W07_KIND.roboticsFactory, 4, -3, 35_000);

  await page.locator('[data-testid="dock-tab-production"]').click();
  await expect(page.locator('[data-section="army"]')).toBeVisible();
  await expect(page.locator('.ta-units__card[data-unit="recon"]')).toBeVisible();
  await expect(page.locator('.ta-units__card[data-unit="demoTank"]')).toHaveCount(0);
  await expect(page.locator('.ta-units__card[data-unit="demoArtillery"]')).toHaveCount(0);

  expect((await sendSimCmd(page, 'setRally', { q: 7, r: -2 })).ok).toBe(true);
  await expect(page.locator('[data-rally-readout]')).toContainText('(7, -2)');

  // Order 3 Recon -> supply climbs from 7/10 to 10/10 and 3 Recon roll out to the rally point.
  for (let i = 1; i <= 3; i++) {
    expect((await sendSimCmd(page, 'enqueueTask', { taskId: `u-recon-${i}`, task: { kind: 'buildUnit', unit: 'recon' } })).ok).toBe(true);
  }
  await expect.poll(async () => (await getEntitiesSnapshot(page)).filter((e) => e.kind === W07_KIND.recon).length, { timeout: 40_000 }).toBe(3);
  await expect.poll(async () => (await getColony0(page))?.supply?.used ?? 0, { timeout: 15_000 }).toBe(10);
  await expect(page.locator('[data-testid="hud-supply"] .ta-hud-min__stock-val')).toHaveText('10 / 10');

  // Step 3: At 10/10 supply, ordering another Recon is rejected with supply_cap and the card shows the supply block reason.
  await expect(page.locator('[data-queue-unit="recon"]')).toBeDisabled();
  await expect(page.locator('[data-unit="recon"] [data-supply-reason]')).toBeVisible();
  const rejectAck = await sendSimCmd(page, 'enqueueTask', { taskId: 'u-recon-over', task: { kind: 'buildUnit', unit: 'recon' } });
  expect(rejectAck).toMatchObject({ ok: false, code: 'supply_cap' });

  // Build Drone Control Array at (2, -3) -> cap increases to 18 and 4th Recon order proceeds.
  for (const [res, amt] of [['metals.t1', 500], ['minerals.t1', 500], ['bio.biomass', 250], ['bio.water', 250]] as const) {
    await devConsole(page, `fill ${res} ${amt}`);
  }
  await orderBuild(page, 'b-dca-1', 'droneControlArray', 2, -3);
  await waitForFinishedBuilding(page, W07_KIND.droneControlArray, 2, -3, 30_000);
  await expect.poll(async () => (await getColony0(page))?.supply?.cap ?? 10, { timeout: 15_000 }).toBe(18);
  await expect(page.locator('[data-testid="hud-supply"] .ta-hud-min__stock-val')).toHaveText('10 / 18');

  const okAck = await sendSimCmd(page, 'enqueueTask', { taskId: 'u-recon-4', task: { kind: 'buildUnit', unit: 'recon' } });
  expect(okAck.ok).toBe(true);
  await expect.poll(async () => (await getEntitiesSnapshot(page)).filter((e) => e.kind === W07_KIND.recon).length, { timeout: 25_000 }).toBe(4);

  await devConsole(page, 'warp 1');
  await screenshot(page, '2-3-factory-recon-dca-supply');
  expectNoPageErrors(page);
});

test('@hack 4, 5 & 8. Build Autocannon + Laser Tower -> range/view rings + Alt -> spawnRaid repelled by turrets -> underAttack & raidRepelled (Unbreached)', async ({ page }) => {
  await openW07(page);
  await devConsole(page, 'warp 20');
  for (const [res, amt] of [['metals.t1', 500], ['minerals.t1', 500], ['bio.biomass', 250], ['bio.water', 250]] as const) {
    await devConsole(page, `fill ${res} ${amt}`);
  }

  // Step 4: Build Autocannon at (6, -1) and Laser Tower at (6, -2).
  await orderBuild(page, 'b-auto-1', 'autocannon', 6, -1);
  await orderBuild(page, 'b-laser-1', 'laserTower', 6, -2);
  await waitForFinishedBuilding(page, W07_KIND.autocannon, 6, -1, 30_000);
  await waitForFinishedBuilding(page, W07_KIND.laserTower, 6, -2, 30_000);

  await page.keyboard.press('Backquote'); // close dev console so clicks and Alt reach the viewport
  await clickTile(page, 6, -1);
  await expect.poll(() => getRingMeshCount(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(2);

  await clickTile(page, 6, -2);
  await expect.poll(() => getRingMeshCount(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(2);

  await page.keyboard.down('Alt');
  await expect.poll(() => getRingMeshCount(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(6);
  await screenshot(page, '4-turret-range-rings-alt');
  await page.keyboard.up('Alt');

  // Step 5 & 8: Trigger a 3-ant raid (`spawnRaid 3`), turrets fire and repel the raid with 0 buildings lost.
  await devConsole(page, 'warp 20');
  await devConsole(page, 'spawnRaid 3');
  await expect(page.locator('[data-testid="combat-log"]')).toHaveAttribute('data-empty', 'false', { timeout: 25_000 });
  await expect(page.locator('[data-testid="combat-log-list"]')).toContainText(/Raid incoming|Colony under attack/, { timeout: 25_000 });
  await expect(page.locator('[data-testid="combat-log-list"]')).toContainText('Raid repelled (Unbreached)', { timeout: 45_000 });

  await devConsole(page, 'warp 1');
  await screenshot(page, '5-8-raid-repelled-unbreached');
  expectNoPageErrors(page);
});

test('@hack 6 & 7. Demo artillery + hitDebug on (evasive Recon vs stationary ant) and explicit attack on passive hive -> nestDestroyed', async ({ page }) => {
  await openW07(page);
  await devConsole(page, 'warp 20');

  // Step 6: Enable hitDebug, spawn demoArtillery + Recon, and fire at a passive ant.
  const hdOut = await devConsole(page, 'hitDebug on');
  expect(hdOut).toContain('hitDebug on');
  await devConsole(page, 'spawnUnit recon 24 0 3');
  await devConsole(page, 'spawnUnit demoArtillery 22 0 2');

  const antHiveBefore = (await getEntitiesSnapshot(page)).find((e) => e.kind === W07_KIND.hiveBlackAnt)!;
  expect(antHiveBefore).toBeTruthy();
  const antsBefore = (await getEntitiesSnapshot(page)).filter((e) => e.kind === W07_KIND.blackAnt);
  expect(antsBefore.length).toBeGreaterThan(0);

  // Order the spawned units to attack the first ant -> provokes the ant hive and triggers artillery shells.
  const reconsAndArtillery = (await getEntitiesSnapshot(page))
    .filter((e) => e.kind === W07_KIND.recon || e.kind === W07_KIND.demoArtillery)
    .map((e) => e.id);
  expect(reconsAndArtillery.length).toBeGreaterThanOrEqual(5);
  expect((await sendSimCmd(page, 'attackTarget', { entityIds: reconsAndArtillery, targetId: antsBefore[0]!.id })).ok).toBe(true);

  await expect.poll(async () => {
    const nowAnts = (await getEntitiesSnapshot(page)).filter((e) => e.kind === W07_KIND.blackAnt);
    return nowAnts.length < antsBefore.length;
  }, { timeout: 30_000 }).toBe(true);
  await screenshot(page, '6-artillery-hitdebug');

  // Step 7: Explicitly attack the blackAnt hive at (30, 0) until destroyed (HP 1500) -> nestDestroyed fires.
  const remainingHive = (await getEntitiesSnapshot(page)).find((e) => e.id === antHiveBefore.id);
  if (remainingHive) {
    await devConsole(page, 'spawnUnit demoTank 27 0 6');
    const allAttackers = (await getEntitiesSnapshot(page))
      .filter((e) => e.kind === W07_KIND.recon || e.kind === W07_KIND.demoArtillery || e.kind === W07_KIND.demoTank)
      .map((e) => e.id);
    if (allAttackers.length > 0 && (await getEntitiesSnapshot(page)).some((e) => e.id === remainingHive.id)) {
      await sendSimCmd(page, 'attackTarget', { entityIds: allAttackers, targetId: remainingHive.id });
    }
  }
  await expect.poll(async () => (await getEntitiesSnapshot(page)).some((e) => e.id === antHiveBefore.id), { timeout: 45_000 }).toBe(false);
  await expect(page.locator('[data-testid="combat-log-list"]')).toContainText('Fauna nest destroyed', { timeout: 15_000 });

  await devConsole(page, 'warp 1');
  await screenshot(page, '7-hive-destroyed');
  expectNoPageErrors(page);
});

test('@hack 9 & 10. Second browser / reconnect parity during a wave, building destruction -> Prepared pad, and waves=..06 disables W07', async ({ page }) => {
  await openW07(page);
  await devConsole(page, 'warp 10');

  // Step 10: Destroy the Capacitor Bank at (-2, -3) with `damage <id> 100` -> removed and its tiles become Prepared (PREP.prepared = 2).
  const cap = (await getEntitiesSnapshot(page)).find((e) => e.q === -2 && e.r === -3)!;
  expect(cap).toBeTruthy();
  await devConsole(page, `damage ${cap.id} 100`);
  await expect.poll(async () => (await getEntitiesSnapshot(page)).some((e) => e.id === cap.id), { timeout: 15_000 }).toBe(false);
  await expect.poll(async () => getTilePrepAt(page, -2, -3), { timeout: 10_000 }).toBe(2);
  await screenshot(page, '10-building-destroyed-prepared-pad');

  // Step 9: Open a second browser page connected during a wave and verify hive/entity agreement.
  await devConsole(page, 'spawnRaid 3');
  const ents1 = await getEntitiesSnapshot(page);
  const page2 = await page.context().newPage();
  await openW07(page2, { as: 'b' });
  const ents2 = await getEntitiesSnapshot(page2);
  const hives1 = ents1.filter((e) => e.kind >= W07_KIND.hiveBlackAnt && e.kind <= W07_KIND.hiveGreenSpitter).map((e) => e.kind).sort();
  const hives2 = ents2.filter((e) => e.kind >= W07_KIND.hiveBlackAnt && e.kind <= W07_KIND.hiveGreenSpitter).map((e) => e.kind).sort();
  expect(hives1).toEqual(hives2);
  await page2.close();

  // Wave DoD: with `waves=..06` on w03, there is no fauna, combat UI, Factory or turret.
  await openW07(page, { waves: '..06' }, 'w03');
  await expect(page.locator('.ta-construction__card[data-building="roboticsFactory"]')).toHaveCount(0);
  await expect(page.locator('.ta-construction__card[data-building="autocannon"]')).toHaveCount(0);
  await expect(page.locator('.ta-construction__card[data-building="laserTower"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="combat-hud"]')).toHaveCount(0);
  expectNoPageErrors(page);
});
