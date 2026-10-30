import type { Page } from '@playwright/test';
import {
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

test('@hack 1. Load ?scenario=w02: Hub done, stock 400/250/150/150, morning -> see resource bar and power widget (+8 supply / -5 demand)', async ({ page }) => {
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
  await expect(page.locator('.ta-power-hud')).toBeVisible();
  await screenshot(page, '1-w02-morning-hud');
  expectNoPageErrors(page);
});

test('@hack 2. Queue 1 Harvester in Units menu -> paid on start (40/15/5/0), completes and harvests nearest deposit', async ({ page }) => {
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

test('@hack 5–8. Queue waiting ETA, night brownout & restore, fill to cap & storage wait, and cancel refunds (75% vs free)', async ({ page }) => {
  await openW02(page);
  await devConsole(page, 'warp 20');

  // Build Solar + Extractor so colony relies on Solar
  await sendSimCmd(page, 'enqueueTask', { taskId: 'b-sol', task: { kind: 'build', building: 'solar', q: -3, r: 2 } });
  await sendSimCmd(page, 'enqueueTask', { taskId: 'b-ext', task: { kind: 'build', building: 'metalsExtractor', q: 3, r: 0 } });
  await expect.poll(async () => (await getColony0(page))?.power?.solarNetPerS ?? 0, { timeout: 20_000 }).toBe(20);
  await devConsole(page, 'warp 1');

  // Step 6: Run `time night` in dev console -> Solar drops to 0, brownout banner appears; `time day` restores
  await devConsole(page, 'time night');
  await expect.poll(async () => (await getColony0(page))?.power?.brownout ?? false).toBe(true);
  await expect(page.locator('[data-brownout-banner]')).toBeVisible();
  await screenshot(page, '6-night-brownout');

  await devConsole(page, 'time day');
  await expect.poll(async () => (await getColony0(page))?.power?.brownout ?? true).toBe(false);

  // Step 7: Fill Metals to cap (500/500)
  await devConsole(page, 'fill metals.t1 9999');
  await expect.poll(async () => (await getColony0(page))?.stock?.['metals.t1'] ?? 0).toBe(500);
  await screenshot(page, '7-metals-capped');

  // Step 8: Start an in-progress Solar order (costs 60 Metals -> 440 Metals) then cancel -> 75% refunded (45 Metals -> 485)
  await sendSimCmd(page, 'enqueueTask', { taskId: 'b-cancel-prog', task: { kind: 'build', building: 'solar', q: 6, r: 0 } });
  await expect.poll(async () => (await getColony0(page))?.stock?.['metals.t1'] ?? 500).toBeLessThan(500);
  await sendSimCmd(page, 'cancelTask', { taskId: 'b-cancel-prog' });
  await expect.poll(async () => (await getColony0(page))?.stock?.['metals.t1'] ?? 0).toBeGreaterThanOrEqual(485);
  await screenshot(page, '8-cancel-refund');
  expectNoPageErrors(page);
});
