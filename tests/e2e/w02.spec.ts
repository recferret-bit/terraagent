import type { Page } from '@playwright/test';
import {
  clickTile,
  devConsole,
  expect,
  expectNoPageErrors,
  hostMode,
  loadLocal,
  loadScenario,
  screenshot,
  test,
} from './harness';

/**
 * W02 First Light — Wave E2E suite covering demo steps 1–8 (`docs/plan/waves/W02-first-light.md` §1 & W02-34).
 * Every step is tagged `@hack` for `npm run e2e -- --waves ..02 --hack`.
 */
test.describe.configure({ mode: 'serial' });

const local = hostMode() === 'local';

interface OnlineColonyView {
  stock?: Record<string, number>;
  caps?: Record<string, number>;
  power?: {
    supply?: number;
    demand?: number;
    net?: number;
    solarGrossPerS?: number;
    solarNetPerS?: number;
    brownout?: boolean;
    offlineReasons?: Record<string, string>;
    phase?: string;
    clockText?: string;
    daylight?: number;
  };
  queue?: Array<{
    taskId: string;
    lane: string;
    state: string;
    waitReason?: string;
    waitDetail?: string;
    spentCost?: Record<string, number>;
  }>;
}

interface OnlineDebugWindow {
  __online: {
    store: {
      latest: {
        tick: number;
        count: number;
        entities: Float32Array;
        colonies: OnlineColonyView[];
      } | null;
    };
    commands: {
      send(kind: string, args?: unknown): Promise<{ ok: boolean; appliedAtTick?: number; code?: string }>;
    };
  };
}

async function openW02(page: Page, params: Record<string, string> = {}): Promise<void> {
  if (local) {
    await loadLocal(page, 'w02', params);
  } else {
    await loadScenario(page, 'w02', params);
  }
}

const getColony0 = (page: Page) =>
  page.evaluate(() => (window as unknown as OnlineDebugWindow).__online.store.latest?.colonies?.[0] ?? null);

const sendSimCmd = (page: Page, kind: string, args: unknown) =>
  page.evaluate(([k, a]) => (window as unknown as OnlineDebugWindow).__online.commands.send(k, a), [kind, args] as const);

test('@hack 1. Load ?scenario=w02: Hub done, stock 400/250/150/150, morning -> see resource bar, planet clock and energy hover (+8 supply / -5 demand)', async ({ page }) => {
  await openW02(page);
  await expect.poll(async () => (await getColony0(page))?.stock?.['metals.t1'] ?? 0).toBe(400);
  const col = await getColony0(page);
  expect(col?.stock).toMatchObject({
    'metals.t1': 400,
    'minerals.t1': 250,
    'bio.biomass': 150,
    'bio.water': 150,
  });
  expect(col?.power).toMatchObject({
    supply: 8,
    demand: 5,
    net: 3,
    phase: 'day',
  });
  await expect(page.locator('.ta-resources-hud')).toBeVisible();
  await expect(page.locator('[data-testid="hud-daytime"]')).toBeVisible(); // planet time of day in the top bar (the old power widget bar is gone)
  await expect(page.locator('[data-testid="hud-daytime-clock"]')).toHaveText(/^\d\d:\d\d$/);
  // The grid balance lives in the energy (HQ cell) chip's hover popover.
  const energy = page.locator('[data-testid="hud-hq-cell"]');
  await energy.hover();
  await expect(energy.locator('[data-testid="res-income-energy"]')).toBeVisible();
  await expect(energy.locator('[data-testid="res-income-energy"]')).toHaveText('Income (Supply): +8 E/s');
  await expect(energy.locator('[data-testid="res-spending-energy"]')).toHaveText('Spending (Demand): −5 E/s');
  await expect(energy.locator('[data-testid="res-net-energy"]')).toHaveText('Net: +3 E/s');
  await screenshot(page, '1-w02-morning-hud');
  expectNoPageErrors(page);
});

test('@hack 2. Queue 1 Harvester in Units menu -> paid progressively (40/15/5/0), completes and harvests nearest deposit', async ({ page }) => {
  await openW02(page);
  await devConsole(page, 'warp 20');
  const ack = await sendSimCmd(page, 'enqueueTask', {
    taskId: 'u-harv-1',
    task: { kind: 'buildUnit', unit: 'harvester' },
  });
  expect(ack.ok).toBe(true);

  await expect.poll(async () => {
    const v = await page.evaluate(() => {
      const s = (window as unknown as OnlineDebugWindow).__online.store.latest;
      if (!s) return false;
      for (let i = 0; i < s.count; i++) {
        if (s.entities[i * 12 + 1] === 7) return true; // ENTITY_KIND.harvester = 7
      }
      return false;
    });
    return v;
  }, { timeout: 15_000 }).toBe(true);

  await devConsole(page, 'warp 1');
  await screenshot(page, '2-harvester-active');
  expectNoPageErrors(page);
});

test('@hack 3 & 4. Build Metals Extractor on deposit and Solar -> Extractor produces ~1.0 metals.t1/s and Solar provides +20 E/s', async ({ page }) => {
  await openW02(page);
  await devConsole(page, 'warp 20');

  expect((await sendSimCmd(page, 'enqueueTask', {
    taskId: 'b-solar-1',
    task: { kind: 'build', building: 'solar', q: -3, r: 2 },
  })).ok).toBe(true);

  expect((await sendSimCmd(page, 'enqueueTask', {
    taskId: 'b-ext-1',
    task: { kind: 'build', building: 'metalsExtractor', q: 3, r: 0 },
  })).ok).toBe(true);

  await expect.poll(async () => (await getColony0(page))?.power?.solarNetPerS ?? 0, { timeout: 20_000 }).toBe(20);
  await devConsole(page, 'warp 1');
  await screenshot(page, '4-extractor-and-solar-online');
  expectNoPageErrors(page);
});

test('@hack 5–8. Queue waiting ETA, night brownout & restore, fill to cap & storage wait, and cancel refunds (50% of what was paid)', async ({ page }) => {
  await openW02(page);
  await devConsole(page, 'warp 20');

  // Build Solar + Extractor so colony relies on Solar
  await sendSimCmd(page, 'enqueueTask', { taskId: 'b-sol', task: { kind: 'build', building: 'solar', q: -3, r: 2 } });
  await sendSimCmd(page, 'enqueueTask', { taskId: 'b-ext', task: { kind: 'build', building: 'metalsExtractor', q: 3, r: 0 } });
  await expect.poll(async () => (await getColony0(page))?.power?.solarNetPerS ?? 0, { timeout: 20_000 }).toBe(20);
  await expect.poll(async () => (await getColony0(page))?.power?.demand ?? 0, { timeout: 20_000 }).toBeGreaterThanOrEqual(11);
  await devConsole(page, 'warp 1');

  // Step 5: Lower Minerals to 5 (< 20) and queue a second Extractor on the uncovered metals deposit (6, 0) ((4, 0) is
  // inside the first Extractor's 2x2 footprint at (3, 0)) -> see `waiting: Minerals 5/20 · ~N s` (or `(no ETA)`).
  await devConsole(page, 'fill minerals.t1 5');
  await expect.poll(async () => (await getColony0(page))?.stock?.['minerals.t1'] ?? 250).toBe(5);
  await sendSimCmd(page, 'enqueueTask', { taskId: 'b-ext-wait', task: { kind: 'build', building: 'metalsExtractor', q: 6, r: 0 } });
  const waitEntry = async () => ((await getColony0(page))?.queue ?? []).find((e) => e.taskId === 'b-ext-wait');
  await expect.poll(async () => (await waitEntry())?.waitReason ?? '').toBe('resources');
  // polled: one tick may still carry the bare `waiting: resources` before the detailed text
  await expect.poll(async () => (await waitEntry())?.waitDetail ?? '').toMatch(/Minerals 5\/20.*(~\d+ s|\(no ETA\))/);
  await expect(page.locator('[data-task-id="b-ext-wait"] [data-chip-status]')).toContainText('Minerals');
  await screenshot(page, '5-queue-waiting-minerals');
  // A waiting order is cancelled with nothing charged (step 8, second half): Minerals and Water stay as they were
  // (no income on either here; Metals has the Extractor's income).
  const beforeWaitCancel = (await getColony0(page))?.stock ?? {};
  expect(Object.values((await waitEntry())?.spentCost ?? {}).every((v) => v === 0)).toBe(true);
  expect((await sendSimCmd(page, 'cancelTask', { taskId: 'b-ext-wait' })).ok).toBe(true);
  await expect.poll(async () => (await waitEntry()) === undefined).toBe(true);
  const afterWaitCancel = (await getColony0(page))?.stock ?? {};
  expect(afterWaitCancel['minerals.t1']).toBe(beforeWaitCancel['minerals.t1']);
  expect(afterWaitCancel['bio.water']).toBe(beforeWaitCancel['bio.water']);
  await devConsole(page, 'fill minerals.t1 250');

  // Step 6: Run `time night` in dev console -> Solar drops to 0, brownout banner appears; `time day` restores
  await devConsole(page, 'time night');
  await expect.poll(async () => (await getColony0(page))?.power?.brownout ?? false).toBe(true);
  const nightPower = (await getColony0(page))?.power;
  expect(nightPower?.solarNetPerS ?? 99).toBeGreaterThanOrEqual(-1); // Solar gives 0, minus its 1 E/s internal drain
  expect(nightPower?.solarNetPerS ?? 99).toBeLessThanOrEqual(0);
  expect(Object.values(nightPower?.offlineReasons ?? {})).toContain('offline: brownout'); // the Extractor is shed
  await expect(page.locator('.ta-power-hud__brownout[data-brownout="true"]')).toBeVisible();
  await expect(page.locator('.ta-power-hud__brownout')).toContainText('BROWNOUT');
  await screenshot(page, '6-night-brownout');

  await devConsole(page, 'time day');
  await expect.poll(async () => (await getColony0(page))?.power?.brownout ?? true).toBe(false);

  // Step 7: Fill Metals to cap (500/500)
  await devConsole(page, 'fill metals.t1 9999');
  await expect.poll(async () => (await getColony0(page))?.stock?.['metals.t1'] ?? 0).toBe(500);
  await screenshot(page, '7-metals-capped');
  if (!local) {
    // An order costing more than the Metals cap waits on storage with the greyed Supply Depot hint. `tune` is a server
    // dev command; single quotes keep the JSON's double quotes through the console tokenizer.
    // The page keeps predicting with the old cost (the replica reloads tuned numbers only on a reload), so the
    // order may show `in_progress` until the ack: poll the server's verdict. `tune reset` runs even when a step fails,
    // so a 600-Metal Solar never leaks into the next steps.
    await devConsole(page, `tune economyT1Basic.solar.cost '{"metals.t1":600,"minerals.t1":75,"bio.biomass":10,"bio.water":5}'`);
    try {
      await sendSimCmd(page, 'enqueueTask', { taskId: 'b-storage', task: { kind: 'build', building: 'solar', q: 5, r: -4 } });
      await expect.poll(async () => ((await getColony0(page))?.queue ?? []).find((e) => e.taskId === 'b-storage')?.waitReason ?? '', { timeout: 15_000 }).toBe('storage');
      await expect(page.locator('[data-task-id="b-storage"] [data-testid="queue-storage-hint"]')).toContainText('Supply Depot');
      await screenshot(page, '7-waiting-storage');
      expect((await sendSimCmd(page, 'cancelTask', { taskId: 'b-storage' })).ok).toBe(true);
    } finally {
      await devConsole(page, 'tune reset');
    }
  }

  // Step 8: Start a Solar order (paid progressively, slice by slice) and cancel it in progress -> 50% of what was paid
  // so far comes back. Read the paid Metals and the stock together right before the cancel; between that read and the
  // cancel a slice more may be paid (~3 Metals/s) and the Extractor adds ~1 Metal/s, so allow ±3.
  await sendSimCmd(page, 'enqueueTask', { taskId: 'b-cancel-prog', task: { kind: 'build', building: 'solar', q: 5, r: -4 } }); // free ground (a Solar may not stand on a deposit)
  const paidOf = async () => {
    const col = await getColony0(page);
    const entry = col?.queue?.find((e) => e.taskId === 'b-cancel-prog');
    return { stock: col?.stock?.['metals.t1'] ?? 0, paid: entry?.spentCost?.['metals.t1'] ?? 0 };
  };
  await expect.poll(async () => (await paidOf()).paid, { timeout: 20_000 }).toBeGreaterThanOrEqual(30);
  const before = await paidOf();
  expect((await sendSimCmd(page, 'cancelTask', { taskId: 'b-cancel-prog' })).ok).toBe(true);
  await expect.poll(async () => ((await getColony0(page))?.queue ?? []).some((e) => e.taskId === 'b-cancel-prog')).toBe(false);
  const after = (await getColony0(page))?.stock?.['metals.t1'] ?? 0;
  // 50% of 30+ paid is 15+; a 75% refund would be 22.5+ and a full one 30+.
  expect(Math.abs(after - before.stock - before.paid * 0.5)).toBeLessThanOrEqual(3);
  await screenshot(page, '8-cancel-refund');
  expectNoPageErrors(page);
});

/** Own obstacle hexes (forest / rock, no deposit) on screen right of the command dock, nearest the HQ first. */
const ownObstaclesOnScreen = (page: Page) =>
  page.evaluate(() => {
    const o = (window as unknown as { __online: { colonyIndex?: number; tileToScreen(q: number, r: number): { x: number; y: number } | null; store: { latest: { planet: { radius: number }; entities: Float32Array; count: number } | null; latestTiles: { terrain: Uint8Array; owner: Int8Array; deposit: Uint8Array } | null } } }).__online;
    const v = o.store.latest!, t = o.store.latestTiles!, R = v.planet.radius, stride = v.entities.length / v.count;
    // The HQ row (kind 3) names the player's colony when the session index is not set yet.
    let hq = { q: 0, r: 0, owner: o.colonyIndex ?? 0 };
    for (let i = 0; i < v.count; i++) {
      const owner = v.entities[i * stride + 2]!;
      if (v.entities[i * stride + 1] === 3 && (o.colonyIndex === undefined || owner === o.colonyIndex)) hq = { q: v.entities[i * stride + 3]!, r: v.entities[i * stride + 4]!, owner };
    }
    const out: Array<{ q: number; r: number; d: number }> = [];
    let i = 0;
    for (let r = -R; r <= R; r++) {
      for (let q = Math.max(-R, -r - R); q <= Math.min(R, -r + R); q++, i++) {
        if (t.owner[i] !== hq.owner || (t.terrain[i] !== 1 && t.terrain[i] !== 2) || t.deposit[i] !== 0) continue;
        const p = o.tileToScreen(q, r);
        if (!p || p.x < 420 || p.x > innerWidth - 260 || p.y < 120 || p.y > innerHeight - 140) continue;
        out.push({ q, r, d: (Math.abs(q - hq.q) + Math.abs(r - hq.r) + Math.abs(q + r - hq.q - hq.r)) / 2 });
      }
    }
    return out.sort((a, b) => a.d - b.d);
  });

const workJobs = (page: Page) =>
  page.evaluate(() => {
    const v = (window as unknown as { __online: { store: { latest: { blobs?: { workJobs?: { byId?: Record<string, { jobId: string; chainSeq?: number }> } } } | null } } }).__online.store.latest;
    return Object.values(v?.blobs?.workJobs?.byId ?? {}).map((j) => ({ jobId: j.jobId, chainSeq: j.chainSeq ?? 0 }));
  });

test('@hack 9. Terraform dock: TERRAFORM / REPAIR / DISMANTLE, hotkeys only on the open tab, G + click an obstacle -> the chain moves on', async ({ page }) => {
  await openW02(page);
  const menu = page.locator('[data-testid="terraform-menu"]');
  // The Build tab is open: the brush hotkeys do nothing (an armed tool must be visible).
  for (const key of ['g', 'r', 'z']) await page.keyboard.press(key);
  await expect(menu).toHaveAttribute('data-armed', 'false');

  await page.locator('[data-testid="dock-tab-terraform"]').click();
  await expect(page.locator('[data-testid="command-dock"]')).toHaveAttribute('data-active-tab', 'terraform');
  expect(await menu.locator('[data-op]').evaluateAll((els) => els.map((e) => e.getAttribute('data-op')))).toEqual(['terraform', 'repair', 'dismantle']);
  await page.keyboard.press('x'); // X only stops the selected unit
  await expect(menu).toHaveAttribute('data-armed', 'false');

  const [target] = await ownObstaclesOnScreen(page);
  expect(target, 'an own forest / rock hex on screen').toBeTruthy();
  await page.keyboard.press('g');
  await expect(menu).toHaveAttribute('data-armed', 'true');
  // Tall tree props may make the pick land on a neighbouring hex; any terraformable hex starts the chain.
  expect(await clickTile(page, target!.q, target!.r)).toBeTruthy();
  await expect(menu).toHaveAttribute('data-armed', 'false'); // one order per armed click
  await expect.poll(async () => (await workJobs(page)).length, { timeout: 10_000 }).toBeGreaterThan(0);
  await expect(page.locator('[data-testid="tf-status"]')).toContainText('TERRAFORM');

  await devConsole(page, 'warp 20');
  await expect.poll(async () => (await workJobs(page)).some((j) => j.chainSeq >= 1 && j.jobId.includes('~')), { timeout: 30_000 }).toBe(true);
  await devConsole(page, 'warp 1');
  await screenshot(page, '9-terraform-chain');
  expectNoPageErrors(page);
});

test('@hack 10. DoD: ?waves=..01 hides the W02 UI (planet clock, grid lines, Production tab, W02 build cards, power widget)', async ({ page }) => {
  // Server host only: the client narrows the server's flags to ..01 while the scenario keeps its W02 sim.
  test.skip(local, 'the local engine would compile the w02 scenario without W02');
  await openW02(page, { waves: '..01' });
  await expect(page.locator('[data-testid="hud-hq-cell"]')).toBeVisible();
  await expect(page.locator('[data-testid="hud-daytime"]')).toBeHidden();
  await expect(page.locator('[data-testid="hud-hq-cell"] [data-testid="res-income-energy"]')).toBeHidden();
  await expect(page.locator('[data-testid="dock-tab-production"]')).toHaveCount(0);
  // BUILD holds the W01 Hub menu (Command Hub only), not the W02 catalog.
  await expect(page.locator('[data-testid="construction-menu"]')).toBeVisible();
  await expect(page.locator('[data-testid="construction-menu"] [data-building]')).toHaveCount(1);
  await expect(page.locator('[data-building="metalsExtractor"]')).toHaveCount(0);
  await expect(page.locator('.ta-power-hud')).toHaveCount(0);
  // The Terraform tab (a W01 feature) offers TERRAFORM only: REPAIR / DISMANTLE are W02.
  await expect(page.locator('[data-testid="tf-op-terraform"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="tf-op-repair"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="tf-op-dismantle"]')).toHaveCount(0);
  // No W02 overhead HP / progress bars in the scene.
  expect(await page.evaluate(() => {
    const o = (window as unknown as { __online?: { entities?: { healthBars?: { group?: { children?: unknown[] } } } } }).__online;
    return o?.entities?.healthBars?.group?.children?.length ?? 0;
  })).toBe(0);
  await screenshot(page, '10-waves-01-no-w02-ui');
  expectNoPageErrors(page);
});
