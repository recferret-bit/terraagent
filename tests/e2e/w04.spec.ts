import type { BrowserContext, Page } from '@playwright/test';
import {
  expect,
  expectCleanHudLayout,
  expectNoPageErrors,
  hostMode,
  loadLocal,
  loadScenario,
  openDockTab,
  screenshot,
  test,
} from './harness';

/**
 * W04 Maps & Camera — Wave E2E suite covering demo steps 1–5 and 10 (`docs/plan/waves/W04-maps-camera.md` §1 & W04-33).
 * Every step is tagged `@hack` for `npm run e2e -- --waves ..04 --hack`.
 */
test.describe.configure({ mode: 'serial' });

const local = hostMode() === 'local';

let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  page = await context.newPage();
});

test.afterAll(async () => {
  await context?.close();
});

interface MinimapDebugStats {
  dirtyTiles: number;
  totalRepaints: number;
  lastRadius: number;
  lastPlanetId: string | null;
  minimapRedraws: number;
  globalMapRedraws: number;
  minimapHz: number;
  globalMapHz: number;
  entityDotCount: number;
  globalMapOpen: boolean;
  activeLayers: string[];
  registeredLayers: string[];
  visibleLayers?: string[];
  trapezoid?: Array<{ worldX: number; worldZ: number; x: number; y: number }>;
  zoom?: number;
  panX?: number;
  panY?: number;
  lastComposite?: {
    drewFlatBackground: boolean;
    drawnLayers: string[];
    territory: { ownedTileCount: number; borderEdgeCount: number };
    unitDots: number;
  } | null;
}

interface OnlineDebugWindow {
  __online: {
    minimap: MinimapDebugStats | null;
    viewport: {
      camera: {
        position: { x: number; y: number; z: number };
      };
    };
    cam: {
      target: { x: number; y: number; z: number };
      enabled: boolean;
    } | null;
    commands: {
      send(kind: string, args?: unknown): Promise<{ ok: boolean }>;
    };
  };
}

async function openW04(page: Page, params: Record<string, string> = {}): Promise<void> {
  if (local) {
    await loadLocal(page, 'w04', params);
  } else {
    await loadScenario(page, 'w04', params);
  }
}

const getMinimapStats = (page: Page) =>
  page.evaluate(() => (window as unknown as OnlineDebugWindow).__online.minimap);

const getCamState = (page: Page) =>
  page.evaluate(() => {
    const o = (window as unknown as OnlineDebugWindow).__online;
    const c = o.cam;
    if (!c) return null;
    const p = o.viewport.camera.position;
    const dx = p.x - c.target.x;
    const dy = p.y - c.target.y;
    const dz = p.z - c.target.z;
    return {
      x: c.target.x,
      z: c.target.z,
      yaw: Math.atan2(dz, dx),
      dist: Math.hypot(dx, dy, dz),
      enabled: c.enabled,
    };
  });

/** Opens the Command Dock on its Build tab (W03; the tallest pane), when the dock is mounted. */
async function openDockBuildTab(page: Page): Promise<void> {
  if ((await page.getByTestId('command-dock').count()) > 0) await openDockTab(page, 'build');
}

/**
 * The tab-book HUD stays clean: the Command Dock (top right, under the FPS counter) clears the top-center bar and the
 * bottom-right stack, the minimap sits in the top-left corner (the Colony book goes under it), nothing leaves the viewport.
 * W04 has no Colony book (its first tab arrives with W07+); the left book is checked in w20.spec.ts.
 */
const expectCleanW04Layout = (page: Page) => expectCleanHudLayout(page, ['rightBook', 'minimap', 'topCenter', 'bottomLeft', 'bottomRight']);

test('@hack 1. Load ?scenario=w04 (two colonies, partial exploration) -> see the 180 px minimap at top-left with tile colours and a white camera trapezoid', async () => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openW04(page, { waves: '..04' });

  const minimap = page.getByTestId('minimap-hud');
  await expect(minimap).toBeVisible({ timeout: 25_000 });
  const box = await minimap.boundingBox();
  expect(box).not.toBeNull();
  expect(Math.round(box!.width)).toBe(180);
  expect(Math.round(box!.height)).toBe(180);
  expect(box!.x).toBeLessThan(40); // top-left corner, inside the slot padding
  expect(box!.y).toBeLessThan(40);
  expect(box!.y).toBeGreaterThanOrEqual(0);

  // The expanded Command Dock (top right) must not overlap the minimap, the top bar or the bottom-right plates.
  await openDockBuildTab(page);
  await expectCleanW04Layout(page);

  await expect.poll(async () => (await getMinimapStats(page))?.trapezoid?.length ?? 0, { timeout: 25_000 }).toBe(4);
  const stats = await getMinimapStats(page);
  expect(stats?.entityDotCount).toBeGreaterThanOrEqual(5);

  // Verify incremental repainting while workers may also dirty tiles in this live world.
  // The exact one-tile case is covered by rasterCache.spec.ts with a stationary fixture.
  const beforeRepaints = (await getMinimapStats(page))?.totalRepaints ?? 0;
  await page.evaluate(() =>
    (window as unknown as OnlineDebugWindow).__online.commands.send('dev.spawndeposit', {
      q: 3,
      r: -2,
      family: 'metals',
      tier: 1,
    }),
  );
  await expect.poll(async () => (await getMinimapStats(page))?.totalRepaints ?? 0, { timeout: 15_000 }).toBeGreaterThan(beforeRepaints);
  const updated = (await getMinimapStats(page))!;
  expect(updated.dirtyTiles).toBeGreaterThanOrEqual(1);
  expect(updated.dirtyTiles).toBeLessThan(1 + 3 * updated.lastRadius * (updated.lastRadius + 1));

  await screenshot(page, 'w04-step1-minimap');
  expectNoPageErrors(page);
});

test('@hack 2. Click a far corner of the minimap -> the 3D camera pans there; the trapezoid moves to that corner', async () => {
  await expect.poll(async () => (await getCamState(page)) !== null, { timeout: 20_000 }).toBe(true);

  const beforeCam = (await getCamState(page))!;
  const beforeTrap = (await getMinimapStats(page))!.trapezoid!;

  const canvas = page.getByTestId('minimap-canvas');
  const box = (await canvas.boundingBox())!;
  // Click near the bottom-right corner of the minimap canvas (avoiding the top-right expand icon)
  await page.mouse.click(box.x + box.width * 0.82, box.y + box.height * 0.78);

  await expect
    .poll(async () => {
      const after = await getCamState(page);
      return after ? Math.hypot(after.x - beforeCam.x, after.z - beforeCam.z) : 0;
    })
    .toBeGreaterThan(8);

  const afterTrap = (await getMinimapStats(page))!.trapezoid!;
  expect(Math.hypot(afterTrap[0]!.x - beforeTrap[0]!.x, afterTrap[0]!.y - beforeTrap[0]!.y)).toBeGreaterThan(15);

  // Rotate camera 90 degrees with E -> trapezoid rotates
  const yawBefore = (await getCamState(page))!.yaw;
  await page.keyboard.press('e');
  await expect
    .poll(async () => Math.abs(((await getCamState(page))?.yaw ?? yawBefore) - yawBefore))
    .toBeGreaterThan(0.5);

  await screenshot(page, 'w04-step2-minimap-click-pan');
  expectNoPageErrors(page);
});

test('@hack 3. Drag on the minimap -> the camera pans continuously along the drag', async () => {
  await expect.poll(async () => (await getCamState(page)) !== null).toBe(true);

  const canvas = page.getByTestId('minimap-canvas');
  const box = (await canvas.boundingBox())!;

  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.5);
  await page.mouse.down();
  const startCam = (await getCamState(page))!;

  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5, { steps: 4 });
  const midCam = (await getCamState(page))!;

  await page.mouse.move(box.x + box.width * 0.78, box.y + box.height * 0.65, { steps: 4 });
  const endCam = (await getCamState(page))!;
  await page.mouse.up();

  expect(Math.hypot(midCam.x - startCam.x, midCam.z - startCam.z)).toBeGreaterThan(4);
  expect(Math.hypot(endCam.x - midCam.x, endCam.z - midCam.z)).toBeGreaterThan(4);

  // Verify phone landscape 844 x 390 shrinks minimap to 140 px with zero HUD overlap
  await page.setViewportSize({ width: 844, height: 390 });
  await expect
    .poll(async () => Math.round((await page.getByTestId('minimap-hud').boundingBox())?.width ?? 0))
    .toBe(140);
  const mmBox = (await page.getByTestId('minimap-hud').boundingBox())!;
  expect(Math.round(mmBox.height)).toBe(140);
  await openDockBuildTab(page);
  await expectCleanW04Layout(page);

  await page.setViewportSize({ width: 1920, height: 1080 });
  await expectCleanW04Layout(page);

  await page.setViewportSize({ width: 1280, height: 720 });
  await expectCleanW04Layout(page);
  expectNoPageErrors(page);
});

test('@hack 4. Press M -> the fullscreen global map opens with layer chips along the top', async () => {
  const overlay = page.getByTestId('global-map-overlay');
  await expect(overlay).toBeHidden();

  await page.keyboard.press('m');
  await expect(overlay).toBeVisible();
  await expect(overlay).toHaveAttribute('data-open', 'true');

  // While open, WASD does not pan the 3D camera
  const camBefore = (await getCamState(page))!;
  expect(camBefore.enabled).toBe(false);
  await page.keyboard.press('w');
  await page.keyboard.press('d');
  const camAfter = (await getCamState(page))!;
  expect(camAfter.x).toBeCloseTo(camBefore.x, 3);
  expect(camAfter.z).toBeCloseTo(camBefore.z, 3);

  // Tab focus trap stays inside the overlay
  await page.keyboard.press('Tab');
  const insideOverlay = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="global-map-overlay"]');
    return Boolean(el && document.activeElement && el.contains(document.activeElement));
  });
  expect(insideOverlay).toBe(true);

  // Wheel zoom works; the readout shows the zoom and map position
  await page.getByTestId('global-map-canvas').dispatchEvent('wheel', { deltaY: -240 });
  await expect.poll(async () => (await getMinimapStats(page))?.zoom ?? 1).toBeGreaterThan(1);
  await expect(page.getByTestId('global-map-readout')).toContainText('ZOOM');
  await expect(page.getByTestId('global-map-readout')).toContainText('CENTER');

  // Keyboard pans the map itself (the 3D camera stays suspended)
  const panBefore = (await getMinimapStats(page))?.panX ?? 0;
  await page.keyboard.press('a');
  await expect.poll(async () => (await getMinimapStats(page))?.panX ?? 0).toBeGreaterThan(panBefore);

  await screenshot(page, 'w04-step4-global-map-open');
  expectNoPageErrors(page);
});

test('@hack 5. Toggle Terrain off and Territory on -> the map redraws; chips for waves that are off (Market, Threats, Walls when TA_WAVES=..04) are not shown', async () => {
  const overlay = page.getByTestId('global-map-overlay');
  if (!(await overlay.isVisible())) {
    await page.keyboard.press('m');
  }
  await expect(overlay).toBeVisible();

  const chips = page.getByTestId('global-map-chips').locator('[data-layer]');
  await expect(chips).toHaveCount(4);
  await expect(page.getByTestId('map-layer-chip-territory')).toBeVisible();
  await expect(page.getByTestId('map-layer-chip-terrain')).toBeVisible();
  await expect(page.getByTestId('map-layer-chip-resources')).toBeVisible();
  await expect(page.getByTestId('map-layer-chip-units')).toBeVisible();

  // Chips for disabled waves (Market, Threats, Walls) are absent
  await expect(page.getByTestId('map-layer-chip-market')).toHaveCount(0);
  await expect(page.getByTestId('map-layer-chip-threats')).toHaveCount(0);
  await expect(page.getByTestId('map-layer-chip-walls')).toHaveCount(0);

  // Toggle Terrain off while Territory stays on -> redraws territory over flat background
  const redrawsBefore = (await getMinimapStats(page))?.globalMapRedraws ?? 0;
  await page.getByTestId('map-layer-chip-terrain').click();
  await expect(page.getByTestId('map-layer-chip-terrain')).toHaveAttribute('data-active', 'false');
  await expect(page.getByTestId('map-layer-chip-territory')).toHaveAttribute('data-active', 'true');

  const stats = await getMinimapStats(page);
  expect(stats?.globalMapRedraws ?? 0).toBeGreaterThan(redrawsBefore);
  expect(stats?.lastComposite?.drewFlatBackground).toBe(true);
  expect(stats?.lastComposite?.drawnLayers).toContain('territory');
  expect(stats?.lastComposite?.drawnLayers).not.toContain('terrain');
  expect(stats?.lastComposite?.territory.ownedTileCount).toBeGreaterThan(20);

  await screenshot(page, 'w04-step5-territory-over-flat');

  // Press Escape -> closes the global map without opening the pause overlay
  await page.keyboard.press('Escape');
  await expect(overlay).toBeHidden();
  expect((await getCamState(page))?.enabled).toBe(true);
  expectNoPageErrors(page);
});

test('@hack 10. Reload with &waves=..03 -> no minimap, M does nothing', async () => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openW04(page, { waves: '..03' });

  await expect(page.getByTestId('minimap-hud')).toHaveCount(0);
  await expect(page.getByTestId('global-map-overlay')).toHaveCount(0);

  await page.keyboard.press('m');
  await expect(page.getByTestId('global-map-overlay')).toHaveCount(0);

  const stats = await getMinimapStats(page);
  expect(stats).toBeNull();

  await screenshot(page, 'w04-step10-waves-03-off');
  expectNoPageErrors(page);
});
