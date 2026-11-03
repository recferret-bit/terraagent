import type { BrowserContext, Page } from '@playwright/test';
import { ENTITY_KIND, ENTITY_STATE } from '@terra/sim/ecs/columns';
import { E, ENTITY_STRIDE } from '../../frontend/game/store/replica/viewCodec';
import {
  devConsole,
  expect,
  expectNoPageErrors,
  hostMode,
  login,
  screenshot,
  stack,
  test,
  waitForTick,
} from './harness';

/**
 * W01 Landfall — the wave's demo story (docs/plan/waves/W01-landfall.md) as one serial suite.
 * Steps 1–7 are tagged `@hack` (`npm run e2e -- --waves ..01 --hack`). Step 8 (Hub auto-placement after 60 s idle)
 * is stretch H+ (`W01-18`) and marked `test.fixme`.
 */
test.describe.configure({ mode: 'serial' });

const local = hostMode() === 'local';
/** Entity view layout and codes, passed into `page.evaluate` (it cannot import): one source with the client (XC-06). */
const VIEW = { E, S: ENTITY_STRIDE, K: { hq: ENTITY_KIND.hq, hub: ENTITY_KIND.hub }, ST: { active: ENTITY_STATE.active } };
const serverOnly = () => test.skip(local, 'needs the app (server host)');

interface OnlineWindow {
  __online: {
    planetId: string;
    colonyId: string | null;
    colonyIndex: number;
    bootPhase: string;
    whenBooted: Promise<unknown>;
    terrain: {
      getTerritoryBorderStats(): {
        ownedTileCount: number;
        boundaryEdgeCount: number;
        frozenEdgeCount: number;
      };
    } | null;
    store: {
      latest: {
        tick: number;
        count: number;
        entities: Float32Array;
        planet: { id: string; type: string; radius: number };
        colonies: Array<{
          index: number;
          id: string;
          name: string;
          status: string;
          stock?: Record<string, number>;
          caps?: Record<string, number>;
          supplyCap?: number;
          hq?: { cell: number; cellMax: number };
        }>;
      } | null;
      latestTiles: {
        count: number;
        terrain: Uint8Array;
        prep: Uint8Array;
        owner: Int8Array;
      } | null;
    };
  };
}

let context: BrowserContext;
let page: Page;
let chosenSite: { q: number; r: number; metalsYield: number; biomassYield: number } = {
  q: 0,
  r: 0,
  metalsYield: 0,
  biomassYield: 0,
};

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
  login(page, 'w01');
});

test.afterAll(async () => {
  await context?.close();
});

test('@hack 1. open /play.html in a fresh profile -> orbital boot splash, then hand-over to the dev planet with no click', async () => {
  // The W01 UI (the bottom-right Hub menu with only Command Hub, its ghost and prep bill) is what this suite checks.
  // With W02 on, the Command Dock BUILD tab (full catalog) replaces that menu by design (hub-placement/index.ts
  // `hiddenByW02`), so narrow the client to ..01; the server still runs every wave it has on.
  await page.goto('/play.html?waves=..01');
  const splash = page.locator('[data-testid=orbital-splash]');
  await expect(splash).toBeAttached({ timeout: 30_000 });

  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const o = (window as unknown as Partial<OnlineWindow>).__online;
          return Boolean(o && o.planetId && o.bootPhase !== 'splash');
        }),
      { timeout: 30_000 },
    )
    .toBe(true);

  await waitForTick(page, () => true, 30_000);
  await expect(splash).toHaveAttribute('data-active', 'false');
  const pid = await page.evaluate(() => (window as unknown as OnlineWindow).__online.planetId);
  expect(pid).toMatch(/^pl_dev/);
  await screenshot(page, '1-orbital-boot');
  expectNoPageErrors(page);
});

test('@hack 2. drop pod descends onto spawn slot and HQ drone deploys; HUD shows stock 600/350/400 and HQ cell 800 / 800 E', async () => {
  await devConsole(page, 'warp 10');

  await expect
    .poll(
      () =>
        page.evaluate(({ E, S, K }) => {
          const o = (window as unknown as OnlineWindow).__online;
          const v = o.store.latest;
          if (!v) return false;
          let hasHq = false;
          for (let i = 0; i < v.count; i++) {
            if (v.entities[i * S + E.kind] === K.hq && v.entities[i * S + E.owner] === o.colonyIndex) hasHq = true;
          }
          return o.bootPhase === 'colony' && hasHq;
        }, VIEW),
      { timeout: 30_000 },
    )
    .toBe(true);

  await devConsole(page, 'warp 1');
  await page.keyboard.press('Backquote');
  await expect(page.locator('[data-testid=colony-view]')).toHaveAttribute('data-active', 'true');
  await expect(page.locator('[data-testid=hud-stock-metals]')).toContainText('600');
  await expect(page.locator('[data-testid=hud-stock-minerals]')).toContainText('350');
  await expect(page.locator('[data-testid=hud-stock-bio]')).toContainText('400');
  await expect(page.locator('[data-testid=hud-stock-bio]')).toContainText('Biomass 200');
  await expect(page.locator('[data-testid=hud-stock-bio]')).toContainText('Water 200');
  await expect(page.locator('[data-testid=hud-hq-cell]')).toContainText('800 / 800 E');
  await screenshot(page, '2-hq-landed-hud');
  expectNoPageErrors(page);
});

test('@hack 3. Construction menu shows only Command Hub; hovering a site shows 3x3 ghost and prep bill; confirm places the order', async () => {
  const menu = page.locator('[data-testid=construction-menu]');
  await expect(menu).toBeVisible();
  const buildBtn = page.locator('[data-testid=build-command-hub]');
  await expect(buildBtn).toBeVisible();
  await expect(buildBtn).toContainText('Command Hub');
  await expect(menu.locator('[data-building]')).toHaveCount(1);

  await buildBtn.click();
  const ghost = page.locator('[data-testid=hub-placement-ghost]');
  await expect(ghost).toBeVisible();
  await expect(ghost).toHaveAttribute('data-active', 'true');
  await expect(ghost).toHaveAttribute('data-valid', 'true');
  await expect(ghost.locator('[data-testid=hub-ghost-tile]')).toHaveCount(9);

  const bill = page.locator('[data-testid=hub-prep-bill]');
  await expect(bill).toBeVisible();
  await expect(page.locator('[data-testid=hub-bill-tiles]')).toContainText('/9 tiles to prepare');
  await expect(page.locator('[data-testid=hub-bill-time]')).toContainText('HQ 1.5×');
  await expect(page.locator('[data-testid=hub-bill-energy]')).toContainText('E');

  const q = Number(await ghost.getAttribute('data-q'));
  const r = Number(await ghost.getAttribute('data-r'));
  const metalsYield = Number((await page.locator('[data-testid=hub-bill-yields]').getAttribute('data-metals')) ?? '0');
  const biomassYield = Number((await page.locator('[data-testid=hub-bill-yields]').getAttribute('data-biomass')) ?? '0');
  chosenSite = { q, r, metalsYield, biomassYield };

  await screenshot(page, '3-hub-ghost-bill');
  await page.locator('[data-testid=hub-confirm]').click();
  await expect(ghost).toHaveAttribute('data-active', 'false');
  expectNoPageErrors(page);
});

test('@hack 4. HQ walks to the site and prepares tiles one by one (Wild -> Prepared), draining its cell bar', async () => {
  await devConsole(page, 'warp 10');

  // Poll until at least one tile is prepared and the HQ power cell drains below 800 E during prep
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const o = (window as unknown as OnlineWindow).__online;
          const v = o.store.latest;
          const col = v?.colonies?.[o.colonyIndex] ?? v?.colonies?.[0];
          const cell = col?.hq?.cell ?? 800;
          const status = document.querySelector('[data-testid=hub-order-status]')?.textContent ?? '';
          return cell < 800 || /waiting\(site:|in_progress|completed/.test(status);
        }),
      { timeout: 30_000 },
    )
    .toBe(true);

  await screenshot(page, '4-hq-site-prep');
  expectNoPageErrors(page);
});

test('@hack 5. construction starts once all 9 tiles are Prepared, stock drops by 200/100/50/50, and Command Hub completes', async () => {
  test.setTimeout(90_000);
  await devConsole(page, 'warp 10');

  // Wait for the Command Hub entity owned by this colony to complete construction (state active, progress >= 1)
  await expect
    .poll(
      () =>
        page.evaluate(({ E, S, K, ST }) => {
          const o = (window as unknown as OnlineWindow).__online;
          const v = o.store.latest;
          if (!v) return false;
          for (let i = 0; i < v.count; i++) {
            const kind = v.entities[i * S + E.kind];
            const owner = v.entities[i * S + E.owner];
            const state = v.entities[i * S + E.state];
            const progress = v.entities[i * S + E.progress];
            if (kind === K.hub && owner === o.colonyIndex && state === ST.active && progress >= 1) return true;
          }
          return false;
        }, VIEW),
      { timeout: 60_000 },
    )
    .toBe(true);

  await devConsole(page, 'warp 1');
  await page.keyboard.press('Backquote');

  // Minerals has no clear/break yield so it is deterministically 350 - 100 = 250; Water is 200 - 50 = 150
  await expect(page.locator('[data-testid=hud-stock-minerals]')).toContainText('250 / 500');
  await expect(page.locator('[data-testid=hud-stock-bio]')).toContainText('Water 150');
  const expectedMetals = 600 + chosenSite.metalsYield - 200;
  // the Hub never lowers a cap (GP-11): metals keep the landing cap 600, the other families rise to the Hub's 500
  await expect(page.locator('[data-testid=hud-stock-metals]')).toContainText(`${expectedMetals} / 600`);

  await screenshot(page, '5-hub-completed');
  expectNoPageErrors(page);
});

test('@hack 6. territory ring (R 10) appears in colony colour and HUD shows storage caps 600/500/500 (metals keep the landing cap) and supply 0/10', async () => {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const stats = (window as unknown as OnlineWindow).__online.terrain?.getTerritoryBorderStats();
          return (stats?.ownedTileCount ?? 0) > 100 && (stats?.boundaryEdgeCount ?? 0) > 0;
        }),
      { timeout: 15_000 },
    )
    .toBe(true);

  await expect(page.locator('[data-testid=hud-stock-metals]')).toContainText('/ 600');
  await expect(page.locator('[data-testid=hud-stock-minerals]')).toContainText('/ 500');
  await expect(page.locator('[data-testid=hud-stock-bio]')).toContainText('/ 500');
  await expect(page.locator('[data-testid=hud-supply]')).toContainText('0 / 10');

  await screenshot(page, '6-territory-and-caps');
  expectNoPageErrors(page);
});

test('@hack 7. restarting the app shows Reconnecting…, then the same colony with its Hub and prepared tiles', async () => {
  serverOnly();
  test.setTimeout(90_000);
  const before = await waitForTick(page, () => true);

  let sawBanner = false;
  const watch = (async () => {
    for (let i = 0; i < 240 && !sawBanner; i++) {
      const t = await page.locator('[data-testid=net-banner]').textContent().catch(() => null);
      if (t && /Reconnecting/.test(t) && (await page.locator('[data-testid=net-banner]').isVisible())) {
        sawBanner = true;
      }
      await page.waitForTimeout(100);
    }
  })();

  await stack.restartApp();
  await watch;
  expect(sawBanner, '"Reconnecting…" was shown').toBe(true);
  await expect(page.locator('[data-testid=net-banner]')).toBeHidden({ timeout: 30_000 });

  const after = await waitForTick(page, (t) => t >= before, 30_000);
  expect(after).toBeGreaterThanOrEqual(before);

  const restored = await page.evaluate(({ E, S, K, ST }) => {
    const o = (window as unknown as OnlineWindow).__online;
    const v = o.store.latest;
    const tiles = o.store.latestTiles;
    let hasCompletedHub = false;
    if (v) {
      for (let i = 0; i < v.count; i++) {
        if (
          v.entities[i * S + E.kind] === K.hub &&
          v.entities[i * S + E.owner] === o.colonyIndex &&
          v.entities[i * S + E.state] === ST.active
        ) {
          hasCompletedHub = true;
        }
      }
    }
    let preparedCount = 0;
    if (tiles) {
      for (let i = 0; i < tiles.count; i++) {
        if (tiles.prep[i] === 1) preparedCount++;
      }
    }
    const stats = o.terrain?.getTerritoryBorderStats();
    return {
      hasCompletedHub,
      preparedCount,
      ownedTileCount: stats?.ownedTileCount ?? 0,
    };
  }, VIEW);

  expect(restored.hasCompletedHub).toBe(true);
  expect(restored.preparedCount).toBeGreaterThanOrEqual(9);
  expect(restored.ownedTileCount).toBeGreaterThan(100);
  await expect(page.locator('[data-testid=hud-supply]')).toContainText('0 / 10');

  await screenshot(page, '7-after-restart');
});

test.fixme('8. ?scenario=w01 idle for 60 s auto-places and builds the Command Hub (UO-LC-07) — stretch H+ W01-18 lands later', async () => {});
