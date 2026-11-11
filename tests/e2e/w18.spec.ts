import type { BrowserContext, Page } from '@playwright/test';
import {
  devConsole,
  expect,
  expectNoPageErrors,
  hostMode,
  loadLocal,
  loadScenario,
  openColonyTab,
  screenshot,
  sendSimCmd,
  test,
  waitForTick,
} from './harness';

/**
 * W18 PvP & Diplomacy — Wave E2E suite covering demo steps 1–7 (`docs/plan/waves/W18-pvp-diplomacy.md` § Demo story & W18-29).
 * Runs against `--project=server` (default) and `--host local` (`E2E_HOST=local`).
 */
test.describe.configure({ mode: 'serial', timeout: 180_000 });

const local = hostMode() === 'local';

interface W18ColonyView {
  id?: string;
  index?: number;
  name?: string;
  status?: string;
  threatStage?: number;
  raidProtectedUntil?: number;
  criticalEndsAt?: number;
  foundingSectorId?: string;
  stock?: Record<string, number>;
  queue?: Array<{
    taskId: string;
    lane: string;
    state: string;
    task?: { kind?: string; unit?: string };
  }>;
}

interface W18DebugWindow {
  __online?: {
    planetId?: string;
    colonyIndex?: number;
    store: {
      tick: number;
      latest: {
        tick: number;
        count: number;
        entities: Float32Array;
        colonies: W18ColonyView[];
        blobs?: Record<string, unknown>;
      } | null;
    };
  };
}

let context: BrowserContext;
let pageA: Page;

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  pageA = await context.newPage();
});

test.afterAll(async () => {
  await context?.close();
});

async function openW18(target: Page, params: Record<string, string> = {}, as = 'a'): Promise<number> {
  const merged = { shadow: '0', crt: '0', wind: '0', ...params };
  if (local) {
    return loadLocal(target, 'w18', merged, 90_000);
  }
  return loadScenario(target, 'w18', merged, { as, timeout: 90_000 });
}

const getColony = (target: Page, index: number): Promise<W18ColonyView | null> =>
  target.evaluate((idx) => (window as unknown as W18DebugWindow).__online?.store.latest?.colonies?.[idx] ?? null, index);

const getDiplomacyBlob = (target: Page): Promise<Record<string, unknown> | null> =>
  target.evaluate(
    () => ((window as unknown as W18DebugWindow).__online?.store.latest?.blobs?.diplomacy as Record<string, unknown>) ?? null,
  );

async function openJoinSeat(fromPage: Page, seatLetter: 'b' | 'c' | 'd' | 'e'): Promise<Page> {
  if (local) return fromPage;
  const out = await devConsole(fromPage, `planet ${seatLetter}`);
  expect(out).toContain(`as=${seatLetter}`);
  const planetId = await fromPage.evaluate(() => (window as unknown as W18DebugWindow).__online?.planetId ?? '');
  expect(planetId).toMatch(/^pl_/);
  const p = await context.newPage();
  await p.goto(`/play.html?join=${encodeURIComponent(planetId)}&as=${seatLetter}&shadow=0&crt=0&wind=0`);
  await waitForTick(p, () => true, 60_000);
  return p;
}

test('@hack 1. Open ?scenario=w18 -> Colony A (S4, 4 Recons) raids Colony B (S4, unshielded) -> turrets engage and Recons beside B depot siphon resources into A', async () => {
  await openW18(pageA, {}, 'a');

  const colA0 = await getColony(pageA, 0);
  const colB0 = await getColony(pageA, 1);
  expect(colA0?.threatStage).toBe(4);
  expect(colB0?.threatStage).toBe(4);
  expect(colA0?.foundingSectorId).toBe('sec_0_0');

  const aMetalsBefore = colA0?.stock?.['metals.t1'] ?? 0;
  const bMetalsBefore = colB0?.stock?.['metals.t1'] ?? 0;

  await openColonyTab(pageA, 'hq');
  const raidPicker = pageA.getByTestId('raid-target-picker');
  await expect(raidPicker).toBeVisible();

  const bRow = pageA.locator('[data-testid="raid-target-row"][data-colony-id="col_1"]');
  await expect(bRow).toBeVisible();
  await expect(bRow).toHaveAttribute('data-disabled', 'false');
  await bRow.getByTestId('raid-target-dispatch').click();

  await devConsole(pageA, 'warp 50');
  await expect.poll(async () => (await getColony(pageA, 0))?.stock?.['metals.t1'] ?? 0, { timeout: 25_000 }).toBeGreaterThan(aMetalsBefore);
  await expect.poll(async () => (await getColony(pageA, 1))?.stock?.['metals.t1'] ?? bMetalsBefore, { timeout: 15_000 }).toBeLessThan(bMetalsBefore);
  await devConsole(pageA, 'warp 1');

  await screenshot(pageA, '1-w18-raid-siphon');
  expectNoPageErrors(pageA);
});

test('@hack 2. Colony C (aged 1 h at S3) shows newcomer shield: 5 h left, rejects raid with raid_protected, and setShield updates shield', async () => {
  await openColonyTab(pageA, 'hq');
  const cRow = pageA.locator('[data-testid="raid-target-row"][data-colony-id="col_2"]');
  await expect(cRow).toBeVisible();
  await expect(cRow).toHaveAttribute('data-disabled', 'true');
  await expect(cRow.getByTestId('raid-target-reason')).toContainText('newcomer shield: 5 h left');

  const rej = await sendSimCmd(pageA, 'raid', { targetColonyId: 'col_2' });
  expect(rej.ok).toBe(false);
  expect(rej.code).toBe('raid_protected');

  if (!local) {
    const pageC = await openJoinSeat(pageA, 'c');
    const shieldOut = await devConsole(pageC, 'setShield 3');
    expect(shieldOut).toContain('dev.setShield');
    await pageC.close();
  } else {
    const shieldOut = await devConsole(pageA, 'setShield 3 2');
    expect(shieldOut).toContain('dev.setShield');
  }

  await expect(cRow.getByTestId('raid-target-reason')).toContainText('newcomer shield: 3 h left');
  await screenshot(pageA, '2-w18-newcomer-shield');
  expectNoPageErrors(pageA);
});

test('@hack 3. In Colony B: killHq reprints HQ at Basic Hub -> killHub puts B into critical -> second killHq eliminates B into ruins and updates W11 sector living count while retaining founded seat', async ({
  request,
}) => {
  const pageB = await openJoinSeat(pageA, 'b');

  const killHq1 = await devConsole(pageB, local ? 'killHq 1' : 'killHq');
  expect(killHq1).toContain('dev.killHq');

  await expect.poll(async () => {
    const q = (await getColony(pageB, 1))?.queue ?? [];
    return q.some((item) => item.lane === 'units' && item.task?.unit === 'hq');
  }, { timeout: 15_000 }).toBe(true);

  if (!local) {
    await expect(pageB.getByTestId('hq-reprint-status')).toBeVisible();
  }

  // Advance 65s (325 ticks) so the reprinted HQ spawns at B's Hub
  await devConsole(pageB, 'warp 80');
  await expect.poll(async () => {
    const q = (await getColony(pageB, 1))?.queue ?? [];
    return q.some((item) => item.lane === 'units' && item.task?.unit === 'hq');
  }, { timeout: 25_000 }).toBe(false);
  await devConsole(pageB, 'warp 1');

  const killHubOut = await devConsole(pageB, local ? 'killHub 1' : 'killHub');
  expect(killHubOut).toContain('dev.killHub');
  await expect.poll(async () => (await getColony(pageB, 1))?.status ?? '', { timeout: 15_000 }).toBe('critical');

  if (!local) {
    await expect(pageB.getByTestId('colony-critical-banner')).toBeVisible();
    await expect(pageB.getByTestId('colony-critical-title')).toContainText(/\d+:\d{2}/);
  }

  const killHq2 = await devConsole(pageB, local ? 'killHq 1' : 'killHq');
  expect(killHq2).toContain('dev.killHq');
  await expect.poll(async () => (await getColony(pageB, 1))?.status ?? '', { timeout: 15_000 }).toBe('eliminated');

  if (!local) {
    await expect(pageB.getByTestId('colony-eliminated-modal')).toBeVisible();
    const planetId = await pageA.evaluate(() => (window as unknown as W18DebugWindow).__online?.planetId ?? '');
    const secRes = await request.get(`/v1/planets/${encodeURIComponent(planetId)}/sectors`);
    if (secRes.ok()) {
      const body = (await secRes.json()) as {
        sectors?: Array<{ sectorId: string; foundedSeats?: number; liveColonies?: number }>;
      };
      const sec0 = body.sectors?.find((s) => s.sectorId === 'sec_0_0');
      if (sec0) {
        expect(sec0.foundedSeats).toBeGreaterThanOrEqual(4);
      }
    }
    await pageB.close();
  }

  await screenshot(pageA, '3-w18-b-eliminated-ruins');
  expectNoPageErrors(pageA);
});

test('@hack 4 & 5. Colony A offers 6 h truce to D -> D accepts -> A attackMove into D rejected truce_active -> A cancels truce -> 10-min notice holds and A shows Oathbreaker 24 h', async () => {
  await openColonyTab(pageA, 'hq');
  const dipPanelA = pageA.getByTestId('diplomacy-panel');
  await expect(dipPanelA).toBeVisible();

  await dipPanelA.getByTestId('propose-target-colony').selectOption('3');
  await dipPanelA.getByTestId('duration-chip-6h').click();
  await dipPanelA.locator('[data-action="propose-truce"]').click();

  await expect.poll(async () => {
    const blob = await getDiplomacyBlob(pageA);
    return Object.keys((blob?.offers as Record<string, unknown>) ?? {}).length;
  }, { timeout: 15_000 }).toBeGreaterThan(0);

  if (!local) {
    const pageD = await openJoinSeat(pageA, 'd');
    await openColonyTab(pageD, 'hq');
    const acceptBtn = pageD.locator('[data-action="accept-truce"]').first();
    await expect(acceptBtn).toBeVisible({ timeout: 15_000 });
    await acceptBtn.click();
    await pageD.close();
  } else {
    const offerId = await pageA.evaluate(() => {
      const blob = (window as unknown as W18DebugWindow).__online?.store.latest?.blobs?.diplomacy as
        | { offers?: Record<string, { offerId: string }> }
        | undefined;
      return Object.keys(blob?.offers ?? {})[0] ?? '';
    });
    expect(offerId).toBeTruthy();
  }

  if (!local) {
    const aReconId = await pageA.evaluate(() => {
      const s = (window as unknown as W18DebugWindow).__online?.store.latest;
      if (!s) return -1;
      const stride = s.count > 0 ? s.entities.length / s.count : 13;
      for (let i = 0; i < s.count; i++) {
        const o = i * stride;
        if (s.entities[o + 1] === 51 && s.entities[o + 2] === 0) return s.entities[o]!;
      }
      return -1;
    });
    expect(aReconId).toBeGreaterThan(0);
    const amRej = await sendSimCmd(pageA, 'attackMove', { entityId: aReconId, q: 0, r: -16 });
    expect(amRej.ok).toBe(false);
    expect(amRej.code).toBe('truce_active');

    const cancelBtn = dipPanelA.locator('[data-action="cancel-truce"]').first();
    await expect(cancelBtn).toBeVisible();
    await cancelBtn.click();

    await expect(dipPanelA.getByTestId('diplomacy-oathbreaker')).toBeVisible();
    await expect(dipPanelA.getByTestId('diplomacy-oathbreaker')).toContainText(/OATHBREAKER/i);
    await expect(dipPanelA.getByTestId('truce-timer').first()).toContainText(/Notice:/i);
  }

  await screenshot(pageA, '5-w18-truce-notice-oathbreaker');
  expectNoPageErrors(pageA);
});

test('@hack 6. Colony D goes away (presence away) with AI allowed and receives truce offer from E (offerTruce d 6) -> director accepts it', async () => {
  if (!local) {
    const pageD = await openJoinSeat(pageA, 'd');
    const awayOut = await devConsole(pageD, 'presence away');
    expect(awayOut).toMatch(/away at tick \d+/);

    const pageE = await openJoinSeat(pageA, 'e');
    const offerOut = await devConsole(pageE, 'offerTruce d 6');
    expect(offerOut).toContain('dev.offerTruce');

    await devConsole(pageE, 'warp 10');
    await expect.poll(async () => {
      const blob = (await getDiplomacyBlob(pageE)) as {
        truces?: Record<string, { colonyAIndex: number; colonyBIndex: number; status: string }>;
      } | null;
      return Object.values(blob?.truces ?? {}).some(
        (t) => t.status === 'active' && ((t.colonyAIndex === 3 && t.colonyBIndex === 4) || (t.colonyAIndex === 4 && t.colonyBIndex === 3)),
      );
    }, { timeout: 20_000 }).toBe(true);
    await devConsole(pageE, 'warp 1');

    await pageD.close();
    await pageE.close();
  } else {
    const awayOut = await devConsole(pageA, 'presence away 3');
    expect(awayOut).toMatch(/away at tick \d+/);
    const offerOut = await devConsole(pageA, 'offerTruce 3 6');
    expect(offerOut).toContain('dev.offerTruce');
  }

  await screenshot(pageA, '6-w18-away-truce-accepted');
  expectNoPageErrors(pageA);
});

test('@hack 7. Playground ?ruin=1 look and ?waves=..17 flag-off check -> no raid or truce UI and raid/truce commands reject wave_disabled', async () => {
  await pageA.goto('/playground.html?inspect=building.solar&ruin=1');
  await expect(pageA.locator('#info-panel, [data-testid="pg-info"], body')).toBeVisible();
  const ruinActive = await pageA.evaluate(() => new URLSearchParams(location.search).get('ruin') === '1');
  expect(ruinActive).toBe(true);
  await screenshot(pageA, '7a-playground-ruin-solar');

  await openW18(pageA, { waves: '..17' }, 'a-w17');
  await expect(pageA.getByTestId('raid-target-picker')).toHaveCount(0);
  await expect(pageA.getByTestId('diplomacy-panel')).toHaveCount(0);

  const raidRej = await sendSimCmd(pageA, 'raid', { targetColonyId: 'col_1' });
  expect(raidRej.ok).toBe(false);
  expect(raidRej.code).toBe('wave_disabled');

  const truceRej = await sendSimCmd(pageA, 'diplomacy.proposeTruce', { targetColonyId: 'col_3', hours: 6 });
  expect(truceRej.ok).toBe(false);
  expect(truceRej.code).toBe('wave_disabled');

  await screenshot(pageA, '7b-waves-17-flag-off');
  expectNoPageErrors(pageA);
});
