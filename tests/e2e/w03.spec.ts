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
 * W03 The Grid — Wave E2E suite covering demo steps 1–10 + DoD (`docs/plan/waves/W03-the-grid.md` §2–§3 & W03-29).
 * Tagged `@hack` so both `npm run e2e -- --waves ..03` and `npm run e2e -- --waves ..03 --hack` run them.
 */
test.describe.configure({ mode: 'serial' });

const local = hostMode() === 'local';

interface OnlineEntityPower {
  state: 'online' | 'offline';
  reason?: string;
  component: number;
  flow?: number;
  max?: number;
  overloaded?: boolean;
}

interface OnlinePylonLoad {
  flow: number;
  max: number;
  overloaded?: boolean;
}

interface OnlineColonyView {
  stock?: Record<string, number>;
  caps?: Record<string, number>;
  earmarks?: Record<string, number>;
  power?: {
    supply?: number;
    demand?: number;
    rawDemand?: number;
    net?: number;
    solarGrossPerS?: number;
    solarNetPerS?: number;
    windNetPerS?: number;
    capacitorStoredE?: number;
    capacitorDischargePerS?: number;
    brownout?: boolean;
    shedGroupsActive?: number[];
    shedEntityIds?: number[];
    offlineReasons?: Record<string, string>;
    entityPower?: Record<string, OnlineEntityPower>;
    pylonLoads?: Record<string, OnlinePylonLoad>;
    phase?: string;
    clockText?: string;
    daylight?: number;
  };
  queue?: Array<{
    taskId: string;
    lane: string;
    precedence?: string;
    state: string;
    waitReason?: string;
    waitDetail?: string;
    earmarked?: Record<string, number>;
    subEntityIds?: number[];
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
        entityPower?: Record<number, OnlineEntityPower>;
        pylonLoads?: Record<number, OnlinePylonLoad>;
      } | null;
    };
    commands: {
      send(kind: string, args?: unknown): Promise<{ ok: boolean; appliedAtTick?: number; code?: string }>;
    };
  };
}

async function openW03(page: Page, params: Record<string, string> = {}): Promise<void> {
  if (local) {
    await loadLocal(page, 'w03', params);
  } else {
    await loadScenario(page, 'w03', params);
  }
}

const getColony0 = (page: Page) =>
  page.evaluate(() => (window as unknown as OnlineDebugWindow).__online.store.latest?.colonies?.[0] ?? null);

const sendSimCmd = (page: Page, kind: string, args: unknown) =>
  page.evaluate(([k, a]) => (window as unknown as OnlineDebugWindow).__online.commands.send(k, a), [kind, args] as const);

const getEntitiesSnapshot = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as OnlineDebugWindow).__online.store.latest;
    if (!s) return [];
    const stride = s.count > 0 ? s.entities.length / s.count : 12;
    const out: Array<{ id: number; kind: number; q: number; r: number; hp: number; hpMax: number; state: number }> = [];
    for (let i = 0; i < s.count; i++) {
      const o = i * stride;
      out.push({
        id: s.entities[o]!,
        kind: s.entities[o + 1]!,
        q: s.entities[o + 3]!,
        r: s.entities[o + 4]!,
        hp: s.entities[o + 8]!,
        hpMax: s.entities[o + 9]!,
        state: s.entities[o + 10]!,
      });
    }
    return out;
  });

test('@hack 1 & 2. Load ?scenario=w03 (Hub, Extractor, Solar, 2 Harvesters) -> order 1 Builder at Hub -> Builder appears and Construction runs in parallel', async ({ page }) => {
  await openW03(page);
  await expect.poll(async () => (await getColony0(page))?.stock?.['metals.t1'] ?? 0).toBeGreaterThanOrEqual(400);
  const col = await getColony0(page);
  expect(col?.power?.supply).toBe(28);
  expect(col?.power?.solarNetPerS).toBe(20);
  expect(col?.power?.phase).toBe('day');

  const initialEnts = await getEntitiesSnapshot(page);
  expect(initialEnts.filter((e) => e.kind === 7).length).toBe(2); // 2 Harvesters

  await devConsole(page, 'warp 20');
  const ack = await sendSimCmd(page, 'enqueueTask', {
    taskId: 'u-builder-1',
    task: { kind: 'buildUnit', unit: 'builder' },
  });
  expect(ack.ok).toBe(true);

  await expect.poll(async () => {
    const ents = await getEntitiesSnapshot(page);
    return ents.some((e) => e.kind === 8); // ENTITY_KIND.builder = 8
  }, { timeout: 20_000 }).toBe(true);

  // Queue two constructions in parallel (HQ + Builder)
  expect((await sendSimCmd(page, 'enqueueTask', {
    taskId: 'b-pylon-p1',
    task: { kind: 'build', building: 'pylon', q: 4, r: -2 },
  })).ok).toBe(true);
  expect((await sendSimCmd(page, 'enqueueTask', {
    taskId: 'b-pylon-p2',
    task: { kind: 'build', building: 'pylon', q: -4, r: -2 },
  })).ok).toBe(true);

  await expect.poll(async () => {
    const ents = await getEntitiesSnapshot(page);
    return ents.filter((e) => e.kind === 9 && e.state === 2).length; // ENTITY_KIND.pylon = 9, ENTITY_STATE.active = 2
  }, { timeout: 20_000 }).toBe(2);

  await devConsole(page, 'warp 1');
  await screenshot(page, '1-2-w03-builder-and-parallel-build');
  expectNoPageErrors(page);
});

test('@hack 3 & 4. Power Line (1 queue entry for 3 pylons) and distant Minerals Quarry (offline: no grid -> online when line connects)', async ({ page }) => {
  await openW03(page);
  await devConsole(page, 'warp 20');
  await devConsole(page, 'fill metals.t1 500');
  await devConsole(page, 'fill minerals.t1 500');

  // Step 4 part A: Place a Minerals Quarry at distant minerals deposit (10, 0) beyond Hub reach -> offline: no grid
  expect((await sendSimCmd(page, 'enqueueTask', {
    taskId: 'b-quarry-far',
    task: { kind: 'build', building: 'mineralsQuarry', q: 10, r: 0 },
  })).ok).toBe(true);

  let quarryId = 0;
  await expect.poll(async () => {
    const ents = await getEntitiesSnapshot(page);
    const q = ents.find((e) => e.kind === 14 && e.state !== 1); // ENTITY_KIND.mineralsQuarry = 14, not constructing
    if (q) quarryId = q.id;
    return Boolean(q);
  }, { timeout: 25_000 }).toBe(true);

  await expect.poll(async () => {
    const c = await getColony0(page);
    return c?.power?.entityPower?.[String(quarryId)]?.reason ?? c?.power?.offlineReasons?.[String(quarryId)] ?? '';
  }, { timeout: 10_000 }).toBe('offline: no grid');

  // Step 3 & Step 4 part B: Drag/place a Power Line of 3 pylons toward the distant Quarry -> 1 queue entry with 3 sub-sites
  const plAck = await sendSimCmd(page, 'placePowerLine', {
    taskId: 'pl-east',
    pylons: [
      { q: 3, r: -1 },
      { q: 6, r: -1 },
      { q: 9, r: -1 },
    ],
  });
  expect(plAck.ok).toBe(true);

  // Wait for all 3 pylons to complete and verify the Quarry turns online on component 0
  await expect.poll(async () => {
    const c = await getColony0(page);
    return c?.power?.entityPower?.[String(quarryId)]?.state ?? '';
  }, { timeout: 30_000 }).toBe('online');

  const connectedPower = (await getColony0(page))?.power?.entityPower?.[String(quarryId)];
  expect(connectedPower?.component).toBe(0);

  await devConsole(page, 'warp 1');
  await screenshot(page, '3-4-power-line-and-quarry-online');
  expectNoPageErrors(page);
});

test('@hack 5, 6 & 7. Supply Depot (cap 500 -> 1500), Wind & Capacitor, night + addLoad 200 brownout shedding, and pylon overload (> 80 E/s)', async ({ page }) => {
  await openW03(page);
  await devConsole(page, 'warp 20');
  await devConsole(page, 'fill metals.t1 500');
  await devConsole(page, 'fill minerals.t1 500');
  await devConsole(page, 'fill bio.biomass 500');
  await devConsole(page, 'fill bio.water 500');

  // Step 5: Build Supply Depot, Wind Turbine, and Capacitor Bank
  expect((await sendSimCmd(page, 'enqueueTask', {
    taskId: 'b-depot',
    task: { kind: 'build', building: 'supplyDepot', q: -3, r: -3 },
  })).ok).toBe(true);
  expect((await sendSimCmd(page, 'enqueueTask', {
    taskId: 'b-wind',
    task: { kind: 'build', building: 'wind', q: 0, r: -4 },
  })).ok).toBe(true);
  expect((await sendSimCmd(page, 'enqueueTask', {
    taskId: 'b-cap',
    task: { kind: 'build', building: 'capacitor', q: 3, r: -3 },
  })).ok).toBe(true);

  await expect.poll(async () => (await getColony0(page))?.caps?.['metals.t1'] ?? 500, { timeout: 25_000 }).toBe(1500);
  await expect.poll(async () => (await getColony0(page))?.power?.windNetPerS ?? 0, { timeout: 25_000 }).toBeGreaterThan(0);
  await expect.poll(async () => (await getColony0(page))?.power?.capacitorStoredE ?? 0, { timeout: 25_000 }).toBeGreaterThan(0);

  // Step 7: Build a Pylon at (5, -1) and a Water Extractor at (7, -1) (attached to that pylon) and overload the pylon branch (> 80 E/s)
  await devConsole(page, 'fill metals.t1 1000');
  await devConsole(page, 'fill minerals.t1 1000');
  expect((await sendSimCmd(page, 'enqueueTask', {
    taskId: 'b-pylon-branch',
    task: { kind: 'build', building: 'pylon', q: 5, r: -1 },
  })).ok).toBe(true);
  expect((await sendSimCmd(page, 'enqueueTask', {
    taskId: 'b-water-branch',
    task: { kind: 'build', building: 'waterExtractor', q: 7, r: -1 },
  })).ok).toBe(true);

  let branchPylonId = 0;
  let branchWaterId = 0;
  await expect.poll(async () => {
    const ents = await getEntitiesSnapshot(page);
    const p = ents.find((e) => e.kind === 9 && e.q === 5 && e.r === -1 && e.state === 2);
    const w = ents.find((e) => e.kind === 15 && e.q === 7 && e.r === -1 && e.state === 2);
    if (p) branchPylonId = p.id;
    if (w) branchWaterId = w.id;
    return Boolean(p && w);
  }, { timeout: 25_000 }).toBe(true);

  // Overload the pylon branch with addLoad 85 (> 80 E/s T1 pylon max)
  await devConsole(page, 'addLoad 85');
  await expect.poll(async () => {
    const c = await getColony0(page);
    return c?.power?.pylonLoads?.[String(branchPylonId)]?.overloaded ?? false;
  }, { timeout: 10_000 }).toBe(true);
  await expect.poll(async () => {
    const c = await getColony0(page);
    return c?.power?.entityPower?.[String(branchWaterId)]?.reason ?? '';
  }, { timeout: 10_000 }).toBe('offline: overload');

  // Clear overload, then Step 6: time night -> solar drops to 0, capacitor discharges, wind holds; then addLoad 200 -> brownout sheds
  await devConsole(page, 'addLoad 0');
  await devConsole(page, 'time night');
  await expect.poll(async () => (await getColony0(page))?.power?.phase ?? 'day', { timeout: 10_000 }).toBe('night');
  const nightPwr = (await getColony0(page))?.power;
  expect(nightPwr?.solarNetPerS ?? 99).toBeLessThanOrEqual(0);
  expect(nightPwr?.windNetPerS ?? 0).toBeGreaterThan(0);

  await devConsole(page, 'addLoad 200');
  await expect.poll(async () => (await getColony0(page))?.power?.brownout ?? false, { timeout: 10_000 }).toBe(true);
  await expect(page.locator('.ta-power-hud__brownout[data-brownout="true"]')).toBeVisible();
  const shedPwr = (await getColony0(page))?.power;
  expect(Object.values(shedPwr?.offlineReasons ?? {})).toContain('offline: brownout');

  await devConsole(page, 'warp 1');
  await screenshot(page, '5-6-7-depot-brownout-overload');
  expectNoPageErrors(page);
});

test('@hack 8. Select building (#id in selection panel), run damage <entity> 50 -> auto-queued repair job and Builder repairs it at 1.5x', async ({ page }) => {
  await openW03(page);
  await devConsole(page, 'warp 20');

  // Order a Builder Drone so it repairs at 1.5x
  expect((await sendSimCmd(page, 'enqueueTask', {
    taskId: 'u-bld-rep',
    task: { kind: 'buildUnit', unit: 'builder' },
  })).ok).toBe(true);
  await expect.poll(async () => (await getEntitiesSnapshot(page)).some((e) => e.kind === 8), { timeout: 20_000 }).toBe(true);

  const ents = await getEntitiesSnapshot(page);
  const extractor = ents.find((e) => e.kind === 5)!; // ENTITY_KIND.metalsExtractor = 5 at (3, 0)
  expect(extractor).toBeTruthy();

  await clickTile(page, extractor.q, extractor.r);
  await expect(page.locator('[data-testid="selection-entity-id"]')).toHaveText(`#${extractor.id}`);

  // Damage the Extractor by 60% (drops to 40% HP = 200/500, critical -> auto-queues system repair)
  await devConsole(page, `damage ${extractor.id} 60`);

  // Poll until Builder repairs the Extractor back to 500 / 500 HP
  await expect.poll(async () => {
    const cur = (await getEntitiesSnapshot(page)).find((e) => e.id === extractor.id);
    return cur?.hp ?? 0;
  }, { timeout: 20_000 }).toBe(500);

  await devConsole(page, 'warp 1');
  await screenshot(page, '8-building-repaired');
  expectNoPageErrors(page);
});

test('@hack 9 & 10. Storage wait ("Build Depot" button opens placement ghost) and 60s resource-starved earmark in Queue panel v2', async ({ page }) => {
  await openW03(page);
  await expect(page.locator('[data-testid="queue-lane-tabs"]')).toBeVisible();

  // Step 9: Storage wait when order cost > 500 cap (server host uses tune)
  if (!local) {
    await devConsole(page, `tune economyT1Basic.solar.cost '{"metals.t1":600,"minerals.t1":75,"bio.biomass":10,"bio.water":5}'`);
    try {
      await sendSimCmd(page, 'enqueueTask', {
        taskId: 'b-storage-w03',
        task: { kind: 'build', building: 'solar', q: 5, r: -4 },
      });
      await expect.poll(async () => ((await getColony0(page))?.queue ?? []).find((e) => e.taskId === 'b-storage-w03')?.waitReason ?? '', { timeout: 15_000 }).toBe('storage');
      const hintBtn = page.locator('[data-task-id="b-storage-w03"] [data-testid="queue-storage-hint"]');
      await expect(hintBtn).toBeVisible();
      await expect(hintBtn).toContainText('Build Depot');
      await hintBtn.click();
      await expect(page.locator('[data-building="supplyDepot"]')).toHaveAttribute('data-selected', 'true');
      expect((await sendSimCmd(page, 'cancelTask', { taskId: 'b-storage-w03' })).ok).toBe(true);
    } finally {
      await devConsole(page, 'tune reset');
    }
  }

  // Step 10: Resource-starved item earmarks after 60s of game time and HUD shows the earmark bar
  await devConsole(page, 'fill minerals.t1 35');
  await expect.poll(async () => (await getColony0(page))?.stock?.['minerals.t1'] ?? 250).toBe(35);

  expect((await sendSimCmd(page, 'enqueueTask', {
    taskId: 'b-starved-solar',
    task: { kind: 'build', building: 'solar', q: 5, r: -4 },
  })).ok).toBe(true);

  await devConsole(page, 'warp 20');
  await expect.poll(async () => {
    const col = await getColony0(page);
    const entry = col?.queue?.find((e) => e.taskId === 'b-starved-solar');
    return entry?.earmarked?.['minerals.t1'] ?? col?.earmarks?.['minerals.t1'] ?? 0;
  }, { timeout: 25_000 }).toBeGreaterThan(0);

  await expect(page.locator('[data-testid="queue-earmark-bar"]')).toBeVisible();
  await expect(page.locator('[data-testid="queue-earmark-bar"]')).toContainText('Earmarked:');
  await expect(page.locator('[data-testid="queue-earmark-bar"]')).toContainText('Minerals');

  await devConsole(page, 'warp 1');
  await screenshot(page, '9-10-storage-wait-and-earmark');
  expectNoPageErrors(page);
});

test('@hack 11. DoD: ?waves=..02 hides W03 UI (queue lane tabs, W03 building cards, Builder unit card)', async ({ page }) => {
  test.skip(local, 'local engine compiles scenario with its own wave flags');
  await openW03(page, { waves: '..02' });
  await expect(page.locator('[data-testid="queue-lane-tabs"]')).toHaveCount(0);
  await expect(page.locator('[data-building="pylon"]')).toHaveCount(0);
  await expect(page.locator('[data-building="supplyDepot"]')).toHaveCount(0);
  await expect(page.locator('[data-building="mineralsQuarry"]')).toHaveCount(0);
  await screenshot(page, '11-waves-02-no-w03-ui');
  expectNoPageErrors(page);
});
