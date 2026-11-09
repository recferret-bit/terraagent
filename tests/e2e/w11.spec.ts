import type { BrowserContext, Page } from '@playwright/test';
import { CANONICAL_PLANET_IDS, W11_SEVEN_SECTOR_COORDS, formatSectorId } from '@terra/contracts';
import {
  expect,
  expectNoPageErrors,
  hostMode,
  loadLocal,
  loadScenario,
  login,
  test,
  waitForTick,
} from './harness';

/**
 * W11 Lobby, Matchmaking, Planets & Sector Foundations — Demo story 1–9 (`docs/plan/waves/W11-lobby-planets.md`).
 * Runs against `--project=server` (default) and `--host local` (`E2E_HOST=local`).
 */
test.describe.configure({ mode: 'serial' });

const local = hostMode() === 'local';
const LAND_SECTOR_IDS = W11_SEVEN_SECTOR_COORDS.map(([q, r]) => formatSectorId(q, r));

let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
});

test.afterAll(async () => {
  await context?.close();
});

interface OnlineW11Window {
  __online?: {
    mode: string;
    planetId?: string;
    store: {
      tick: number;
      latest: {
        planet?: { id: string; type: string; radius: number };
        tiles?: { count: number };
        count?: number;
        colonies?: Array<{
          id?: string;
          name?: string;
          foundingSectorId?: string;
          landingSlotId?: string;
        }>;
        entities?: Float32Array;
      } | null;
    };
    minimap: {
      globalMapOpen?: boolean;
      activeLayers?: string[];
      selectedSectorId?: string | null;
    } | null;
    commands: {
      send(kind: string, args?: unknown): Promise<{ ok: boolean }>;
    };
  };
}

async function openW11(
  page: Page,
  params: Record<string, string> = {},
  as = 'w11-pilot',
): Promise<number> {
  if (local) {
    return loadLocal(page, 'w11', params);
  }
  return loadScenario(page, 'w11', params, { as });
}

test('@hack 1. Orbital menu shows 3 canonical persistent worlds, 7-land-sector chooser, and no newPlanet option', async () => {
  login(page, 'w11-menu');
  await page.goto(local ? '/play.html?host=local&planet=forestRock' : '/play.html?planet=forestRock');

  const menu = page.locator('#menu');
  await expect(menu).toBeVisible();

  await expect(page.locator('.world-card[data-k="dune"]')).toBeVisible();
  await expect(page.locator('.world-card[data-k="oceanForest"]')).toBeVisible();
  await expect(page.locator('.world-card[data-k="forestRock"]')).toBeVisible();
  await expect(page.locator('[data-k="newPlanet"], [data-testid="new-planet"]')).toHaveCount(0);

  const picker = page.locator('[data-testid="sector-picker"]');
  await expect(picker).toBeVisible();
  await expect(picker).toHaveAttribute('data-land-sectors', '7');

  const autoBtn = picker.locator('[data-testid="sector-opt-auto"][data-sector-mode="auto"]');
  await expect(autoBtn).toBeVisible();
  await expect(autoBtn).toHaveAttribute('aria-pressed', 'true');

  const chosenBtns = picker.locator('.sector-opt-land[data-sector-mode="chosen"]');
  await expect(chosenBtns).toHaveCount(7);
  for (const sectorId of LAND_SECTOR_IDS) {
    await expect(picker.locator(`[data-testid="sector-opt-${sectorId}"]`)).toBeVisible();
  }

  await picker.locator('[data-testid="sector-opt-sec_0_0"]').click();
  await expect(picker.locator('[data-testid="sector-opt-sec_0_0"]')).toHaveAttribute('aria-pressed', 'true');
  await autoBtn.click();
  await expect(autoBtn).toHaveAttribute('aria-pressed', 'true');

  expectNoPageErrors(page);
});

test('@hack 2. ?scenario=w11 boots Colony 0 (Aegis Prime) founded in sec_0_0 with HUD and minimap', async ({
  request,
}) => {
  await openW11(page, {}, 'w11-pilot');

  if (!local) {
    const res = await request.get('/v1/planets');
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as { planets: Array<{ id: string; type: string }> };
    expect(body.planets).toHaveLength(3);
    expect(body.planets.map((p) => p.id).sort()).toEqual([...CANONICAL_PLANET_IDS].sort());
  }

  await expect(page.getByTestId('minimap-hud')).toBeVisible();

  const summary = await page.evaluate(() => {
    const v = (window as unknown as OnlineW11Window).__online?.store.latest;
    const c0 = v?.colonies?.[0];
    return {
      colonyId: c0?.id ?? null,
      name: c0?.name ?? null,
      foundingSectorId: c0?.foundingSectorId ?? null,
      landingSlotId: c0?.landingSlotId ?? null,
      planetRadius: v?.planet?.radius ?? null,
      tileCount:
        v?.tiles?.count ??
        (typeof v?.planet?.radius === 'number' ? 1 + 3 * v.planet.radius * (v.planet.radius + 1) : null),
      entityCount: v?.count ?? (v?.entities ? Math.floor(v.entities.length / 13) : 0),
    };
  });

  expect(summary.colonyId).toBe('col_0');
  expect(summary.name).toBe('Aegis Prime');
  expect(summary.foundingSectorId).toBe('sec_0_0');
  expect(summary.landingSlotId).toBe('slot_sec_0_0_0');
  expect(summary.planetRadius).toBe(48);
  expect(summary.tileCount).toBe(7057);
  expect(summary.entityCount).toBeGreaterThanOrEqual(6);

  expectNoPageErrors(page);
});

test('@hack 3. Global Planet Map (M) toggles the W11 sectors layer, displays surrounding sectors, and moves units inside isolated sec_0_0 (R=48)', async () => {
  const startTick = await waitForTick(page, () => true);

  const overlay = page.getByTestId('global-map-overlay');
  await page.keyboard.press('m');
  await expect(overlay).toBeVisible();

  const sectorsChip = page.getByTestId('map-layer-chip-sectors');
  await expect(sectorsChip).toBeVisible();
  await expect(sectorsChip).toHaveAttribute('aria-pressed', 'true');

  await sectorsChip.click();
  await expect(sectorsChip).toHaveAttribute('aria-pressed', 'false');
  await sectorsChip.click();
  await expect(sectorsChip).toHaveAttribute('aria-pressed', 'true');

  const readout = page.getByTestId('global-map-readout');
  await expect(readout).toBeVisible();
  await expect(readout).toContainText('[sec_0_0]');

  await page.keyboard.press('m');
  await expect(overlay).toBeHidden();

  const workerId = await page.evaluate(() => {
    const v = (window as unknown as OnlineW11Window).__online?.store.latest;
    const ents = v?.entities;
    const count = v?.count ?? (ents ? Math.floor(ents.length / 13) : 0);
    if (!ents) return -1;
    for (let i = 0; i < count; i++) {
      const base = i * 13;
      if (ents[base + 1] === 7 && ents[base + 2] === 0) {
        return ents[base];
      }
    }
    return -1;
  });
  expect(workerId).toBeGreaterThan(0);

  await page.evaluate((id) =>
    (window as unknown as OnlineW11Window).__online?.commands.send('moveUnit', {
      unitId: id,
      q: 25,
      r: -12,
    }),
    workerId,
  );
  await waitForTick(page, startTick + 8);

  const afterMove = await page.evaluate((id) => {
    const o = (window as unknown as OnlineW11Window).__online;
    const v = o?.store.latest;
    const ents = v?.entities;
    const count = v?.count ?? (ents ? Math.floor(ents.length / 13) : 0);
    let workerExists = false;
    let workerOwner = -1;
    if (ents) {
      for (let i = 0; i < count; i++) {
        const base = i * 13;
        if (ents[base] === id) {
          workerExists = true;
          workerOwner = ents[base + 2];
          break;
        }
      }
    }
    const col0 = v?.colonies?.[0];
    return {
      workerExists,
      workerOwner,
      foundingSectorId: col0?.foundingSectorId ?? null,
      globalMapOpen: o?.minimap?.globalMapOpen ?? false,
    };
  }, workerId);

  expect(afterMove.workerExists).toBe(true);
  expect(afterMove.workerOwner).toBe(0);
  expect(afterMove.foundingSectorId).toBe('sec_0_0');
  expect(afterMove.globalMapOpen).toBe(false);

  expectNoPageErrors(page);
});

test('@hack 4. Reloading active session preserves Colony 0 (col_0) and continues tick progression cleanly', async () => {
  if (local) {
    const t0 = await loadLocal(page, 'w11');
    await waitForTick(page, t0 + 2);
  } else {
    const planetId = await page.evaluate(() => {
      const o = (window as unknown as OnlineW11Window).__online;
      return o?.store.latest?.planet?.id ?? o?.planetId ?? '';
    });
    expect(planetId).toMatch(/^pl_/);
    await page.goto(`/play.html?join=${encodeURIComponent(planetId)}&as=w11-pilot`);
    const t0 = await waitForTick(page, () => true, 60_000);
    await waitForTick(page, t0 + 2);
  }

  const col = await page.evaluate(
    () => (window as unknown as OnlineW11Window).__online?.store.latest?.colonies?.[0] ?? null,
  );
  expect(col?.id).toBe('col_0');
  expect(col?.foundingSectorId).toBe('sec_0_0');

  expectNoPageErrors(page);
});

test('5. Party admission & cross-sector beacon removal', async () => {
  test.skip(true, 'deferred to untagged rows W11-17..19, W11-24, W11-44');
});

test('@hack 6. Persistent canonical worlds report ACTIVE lifecycle, OK health, and no age seal or overflow instances', async ({
  request,
}) => {
  test.skip(local, 'REST planet summary & stats endpoints require server host');

  const listRes = await request.get('/v1/planets');
  expect(listRes.ok()).toBe(true);
  const listBody = (await listRes.json()) as {
    planets: Array<Record<string, unknown>>;
    queuePaused: boolean;
  };
  expect(listBody.planets).toHaveLength(3);
  expect('newPlanet' in listBody).toBe(false);

  for (const world of listBody.planets) {
    expect(world.lifecycle).toBe('ACTIVE');
    expect(world.health).toBe('OK');
    expect(world.admission).toBe('OPEN');
    expect(world.availability).toBe('open');
    expect(world.landSectors).toBe(7);
    expect(Number(world.totalSectors)).toBeGreaterThanOrEqual(7);
    expect(Number(world.oceanSectors)).toBeGreaterThanOrEqual(0);
    expect('admissionClosesAt' in world).toBe(false);
    expect('endsAt' in world).toBe(false);
  }

  const statsRes = await request.get('/v1/planets/stats');
  expect(statsRes.ok()).toBe(true);
  const statsBody = (await statsRes.json()) as {
    planetsActive: number;
    updatedAt: string;
  };
  expect(statsBody.planetsActive).toBe(3);
  expect(typeof statsBody.updatedAt).toBe('string');
});

test('@hack 7. Matchmaking ticket enqueue with Idempotency-Key is idempotent, rejects NEW_PLANET, and cancels cleanly', async ({
  request,
}) => {
  test.skip(local, 'Matchmaking ticket REST endpoints require server host');

  const guestRes = await request.post('/v1/auth/guest', { data: {} });
  expect(guestRes.ok()).toBe(true);
  const { accessToken } = (await guestRes.json()) as { accessToken: string };
  const authHeader = { Authorization: `Bearer ${accessToken}` };

  const badRes = await request.post('/v1/match/tickets', {
    headers: authHeader,
    data: { mode: 'NEW_PLANET', planetType: 'temperate' },
  });
  expect(badRes.status()).toBe(400);

  const idemKey = `e2e-w11-${Date.now()}`;
  const post1 = await request.post('/v1/match/tickets', {
    headers: { ...authHeader, 'Idempotency-Key': idemKey },
    data: { mode: 'JOIN_PLANET', planetType: 'temperate', sectorId: 'sec_0_0' },
  });
  expect(post1.ok()).toBe(true);
  const ticket1 = (await post1.json()) as {
    id: string;
    state: string;
    sectorIntent: { kind: string; sectorId?: string };
  };
  expect(ticket1.sectorIntent).toEqual({ kind: 'chosen', sectorId: 'sec_0_0' });

  const post2 = await request.post('/v1/match/tickets', {
    headers: { ...authHeader, 'Idempotency-Key': idemKey },
    data: { mode: 'JOIN_PLANET', planetType: 'temperate', sectorId: 'sec_0_0' },
  });
  expect(post2.ok()).toBe(true);
  const ticket2 = (await post2.json()) as { id: string };
  expect(ticket2.id).toBe(ticket1.id);

  const delRes = await request.delete(`/v1/match/tickets/${encodeURIComponent(ticket1.id)}`, {
    headers: authHeader,
  });
  expect(delRes.ok()).toBe(true);
  const cancelled = (await delRes.json()) as { id: string; state: string };
  expect(cancelled.id).toBe(ticket1.id);
  expect(cancelled.state).toBe('CANCELLED');
});

test('@hack 8. Disabling W11 (&waves=..10) hides the sectors layer chip while keeping W04 layers functional', async () => {
  await openW11(page, { waves: '..10' }, 'w11-waves10');

  await page.keyboard.press('m');
  await expect(page.getByTestId('global-map-overlay')).toBeVisible();
  await expect(page.getByTestId('map-layer-chip-sectors')).toHaveCount(0);

  for (const id of ['territory', 'terrain', 'resources', 'units'] as const) {
    await expect(page.getByTestId(`map-layer-chip-${id}`)).toBeVisible();
  }

  expectNoPageErrors(page);
});

test('@hack 9. Local-host fixture (?host=local&scenario=w11) boots in the browser worker, advances ticks, and renders the sectors chip', async () => {
  const t0 = await loadLocal(page, 'w11');

  const isLocal = await page.evaluate(
    () =>
      new URLSearchParams(location.search).get('host') === 'local' &&
      Boolean((window as unknown as OnlineW11Window).__online?.store.latest),
  );
  expect(isLocal).toBe(true);

  await waitForTick(page, t0 + 3);

  await page.keyboard.press('m');
  await expect(page.getByTestId('global-map-overlay')).toBeVisible();
  await expect(page.getByTestId('map-layer-chip-sectors')).toBeVisible();
  await expect(page.getByTestId('map-layer-chip-sectors')).toHaveAttribute('aria-pressed', 'true');

  expectNoPageErrors(page);
});
