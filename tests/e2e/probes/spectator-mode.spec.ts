import type { Page } from '@playwright/test';
import { expect, expectNoPageErrors, screenshot, stack, test, waitForTick } from '../harness';

interface SpectatorWindow {
  __online?: {
    colonyIndex: number;
    spectator: boolean;
    spectatorVisionAll: boolean;
    clickTile(q: number, r: number): boolean;
    orderMove(q: number, r: number): boolean;
    getSelectedEntityId(): number | null;
    inspectColony(colonyIndex: number, focusCamera?: boolean): void;
    store: {
      tick?: number;
      isSpectator(): boolean;
      recentInputs(colonyIndex?: number): Array<{ colonyIndex: number | null; isBot: boolean; source: string; kind: string }>;
      recentDecisions(colonyIndex?: number): Array<{ colonyIndex: number | null; isBot: boolean }>;
      latest?: {
        colonies: Array<{ index: number; name?: string; status?: string; isBot?: boolean; stock?: Record<string, number> } | null>;
        count: number;
        entities: Float32Array;
      } | null;
    };
  };
}

test.describe.configure({ timeout: 180_000 });

async function assertNoHudOverlap(page: Page): Promise<void> {
  const overlapCheck = await page.evaluate(() => {
    const box = (sel: string) => document.querySelector<HTMLElement>(sel)?.getBoundingClientRect() ?? null;
    const spec = box('[data-testid="spectator-panel"]');
    const spine = box('.ta-command-dock .ta-book__spine');
    const queue = box('.ta-queue-panel');
    const env = box('.ta-env-panel');
    const hqPanel = box('.ta-hq-panel');
    const intersects = (a: DOMRect | null, b: DOMRect | null) =>
      Boolean(a && b && a.width > 0 && a.height > 0 && b.width > 0 && b.height > 0 && !(a.right <= b.left + 1 || a.left >= b.right - 1 || a.bottom <= b.top + 1 || a.top >= b.bottom - 1));
    return { specPresent: Boolean(spec), hitSpine: intersects(spec, spine), hitQueue: intersects(spec, queue), hitEnv: intersects(spec, env), hitSelection: intersects(spec, hqPanel) };
  });
  expect(overlapCheck).toEqual({ specPresent: true, hitSpine: false, hitQueue: false, hitEnv: false, hitSelection: false });
}

test.describe('Local Spectator URL (/play.html?spectator=1)', () => {
  test('launches zero-player bot world, streams backend bot inputs/decisions, and inspects clicked bot like a player', async ({ page }) => {
    expectNoPageErrors(page);
    const ledgerWarnings: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'warning' && m.text().includes('ledger rejected')) ledgerWarnings.push(m.text());
    });
    await page.goto('/play.html?spectator=1&planet=temperate&bots=2&seed=e2e-spec&shadow=0&crt=0&wind=0&water=0&reflect=0&pixel=0');
    await waitForTick(page, (t) => t >= 6, 120_000);

    // Zero human colonies spawned; only 2 bots active in spectator mode
    const worldMeta = await page.evaluate(() => {
      const o = (window as unknown as SpectatorWindow).__online!;
      const cols = o.store.latest?.colonies ?? [];
      return {
        spectator: o.spectator && o.store.isSpectator(),
        humans: cols.filter((c) => Boolean(c && !c.isBot && c.status !== 'founding')).length,
        bots: cols.filter((c) => Boolean(c && c.isBot)).map((c) => ({ index: c!.index, name: c!.name, stock: c!.stock })),
      };
    });
    expect(worldMeta.spectator).toBe(true);
    expect(worldMeta.humans).toBe(0);
    expect(worldMeta.bots).toHaveLength(2);

    // SpectatorPanel HUD is mounted and shows both bot cards and live inputs feed
    const panel = page.locator('[data-testid="spectator-panel"]');
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="spectator-bot-0"]')).toBeVisible();
    await expect(page.locator('[data-testid="spectator-bot-1"]')).toBeVisible();

    await expect.poll(async () => page.evaluate(() => (window as unknown as SpectatorWindow).__online!.store.recentInputs().some((i) => i.isBot && i.source === 'bot' && i.kind === 'enqueueTask')), { timeout: 30_000, intervals: [500] }).toBe(true);
    await expect.poll(async () => page.evaluate(() => (window as unknown as SpectatorWindow).__online!.store.recentDecisions().some((d) => d.isBot)), { timeout: 30_000, intervals: [500] }).toBe(true);

    // Click Bot #1 entity tile directly in the world -> selects bot entity AND switches HUD to Bot #1
    const clickOutcome = await page.evaluate(() => {
      const o = (window as unknown as SpectatorWindow).__online!;
      const s = o.store.latest!;
      const stride = s.count > 0 ? s.entities.length / s.count : 12;
      let target: { q: number; r: number } | null = null;
      for (let i = 0; i < s.count; i++) {
        const idx = i * stride;
        if (s.entities[idx + 2] === 1 && s.entities[idx + 8]! > 0) {
          target = { q: s.entities[idx + 3]!, r: s.entities[idx + 4]! };
          break;
        }
      }
      if (!target) return null;
      const clicked = o.clickTile(target.q, target.r);
      const moveBlocked = o.orderMove(target.q + 1, target.r);
      return { clicked, moveBlocked, colonyIndex: o.colonyIndex, selectedEntityId: o.getSelectedEntityId() };
    });
    expect(clickOutcome).not.toBeNull();
    expect(clickOutcome!.clicked).toBe(true);
    expect(clickOutcome!.moveBlocked).toBe(false);
    expect(clickOutcome!.colonyIndex).toBe(1);
    expect(clickOutcome!.selectedEntityId).not.toBeNull();

    // Verify SpectatorPanel, HqPanel, and MinimalHud reflect Bot #1 + Details/Decisions/Inputs tabs work
    await expect(page.locator('[data-testid="spectator-bot-1"]')).toHaveAttribute('data-selected', 'true');
    await expect(page.locator('[data-testid="hud-colony-name"]')).toHaveText(worldMeta.bots[1]!.name || 'Crimson Vanguard');
    await expect(page.locator('.ta-hq-panel[data-testid="hq-panel"]')).toBeVisible();
    await expect(page.locator('.ta-hq-panel[data-testid="hq-panel"]')).toHaveAttribute('data-entity-id', String(clickOutcome!.selectedEntityId));
    await expect(page.locator('[data-testid="hq-panel-cancel"]')).toBeHidden();
    const metalsChipText = await page.locator('[data-testid="hud-stock-metals"]').textContent();
    expect(metalsChipText?.trim()).toMatch(/\d+\s*\/\s*\d+/);

    await page.locator('[data-testid="dock-tab-queue"]').click();
    await expect(page.locator('.ta-queue-panel')).toBeVisible();
    await expect(page.locator('[data-testid="queue-cancel-all"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="queue-cancel-all"]')).toBeHidden();
    await expect(page.locator('.ta-queue-chip__btn--cancel')).toHaveCount(0);
    await expect(page.locator('[data-testid="hud-colony-name"]')).toBeVisible();
    await assertNoHudOverlap(page);

    // Switch to Bot #0 via SpectatorPanel card and verify HqPanel + MinimalHud update immediately
    await page.locator('[data-testid="spectator-bot-0"]').click();
    await expect(page.locator('[data-testid="spectator-bot-0"]')).toHaveAttribute('data-selected', 'true');
    await expect(page.locator('[data-testid="hud-colony-name"]')).toHaveText(worldMeta.bots[0]!.name || 'Iron Guild Outpost');
    await expect(page.locator('.ta-hq-panel[data-testid="hq-panel"]')).toHaveAttribute('data-entity-id', /^\d+$/);
    const bot0HqAttr = await page.locator('.ta-hq-panel[data-testid="hq-panel"]').getAttribute('data-entity-id');
    expect(bot0HqAttr).not.toBe(String(clickOutcome!.selectedEntityId));
    await page.locator('[data-testid="spectator-bot-1"]').click();
    await expect(page.locator('[data-testid="hud-colony-name"]')).toHaveText(worldMeta.bots[1]!.name || 'Crimson Vanguard');

    await page.locator('[data-testid="spectator-tab-summary"]').click();
    await expect(page.locator('[data-testid="spectator-feed"]')).toContainText('BOT #1');
    await expect(page.locator('[data-testid="spectator-feed"]')).toContainText('RESOURCES');
    await expect(page.locator('[data-testid="spectator-feed"]')).toContainText(/prod \d+ · demand \d+/);
    await expect(page.locator('[data-testid="spectator-feed"]')).toContainText(/\d+\/\d+/);
    await page.locator('[data-testid="spectator-tab-decisions"]').click();
    await expect(page.locator('[data-testid="spectator-feed"]')).toBeVisible();
    await page.locator('[data-testid="spectator-tab-inputs"]').click();
    await expect(page.locator('[data-testid="spectator-tab-inputs"]')).toHaveAttribute('data-active', 'true');

    await screenshot(page, 'local-spectator-bot-1');
    expect(ledgerWarnings).toEqual([]);
    expectNoPageErrors(page);
  });
});

test.describe('Local Spectator Persistence & Reset (/play.html?spectator=1&reset=1)', () => {
  test('persists local spectator progress across reloads and wipes cleanly on &reset=1', async ({ page }) => {
    expectNoPageErrors(page);
    await page.goto('/play.html?spectator=1&planet=temperate&bots=2&seed=e2e-spec-reset&shadow=0&crt=0&wind=0&water=0&reflect=0&pixel=0');
    await waitForTick(page, (t) => t >= 25, 120_000);
    const tickBeforeReload = await page.evaluate(() => (window as unknown as SpectatorWindow).__online!.store.tick ?? 0);
    expect(tickBeforeReload).toBeGreaterThanOrEqual(25);

    // Navigating away triggers pagehide save; returning without reset immediately resumes >= tickBeforeReload
    await page.goto('about:blank');
    await page.goto('/play.html?spectator=1&planet=temperate&bots=2&seed=e2e-spec-reset&shadow=0&crt=0&wind=0&water=0&reflect=0&pixel=0');
    await expect.poll(async () => page.evaluate(() => Boolean((window as unknown as SpectatorWindow).__online?.store.latest)), { timeout: 60_000 }).toBe(true);
    const resumedTick = await page.evaluate(() => (window as unknown as SpectatorWindow).__online!.store.tick ?? 0);
    expect(resumedTick).toBeGreaterThanOrEqual(tickBeforeReload);

    // Navigating with &reset=1 wipes IndexedDB snapshot back to tick 0 (< tickBeforeReload) and strips reset=1
    await page.goto('/play.html?spectator=1&planet=temperate&bots=2&seed=e2e-spec-reset&reset=1&shadow=0&crt=0&wind=0&water=0&reflect=0&pixel=0');
    await waitForTick(page, (t) => t >= 1, 60_000);
    const tickAfterReset = await page.evaluate(() => (window as unknown as SpectatorWindow).__online!.store.tick ?? 0);
    expect(tickAfterReset).toBeLessThan(tickBeforeReload);
    expect(await page.evaluate(() => new URLSearchParams(window.location.search).has('reset'))).toBe(false);
    await expect(page.locator('[data-testid="spectator-bot-0"]')).toBeVisible();
    await expect(page.locator('[data-testid="spectator-bot-1"]')).toBeVisible();
    expectNoPageErrors(page);
  });
});

test.describe('Live Server Spectator URLs (?spectator=1&host=server and ?spectator=1&join=<planetId>)', () => {
  test.skip(process.env.E2E_HOST === 'local', 'Requires live NestJS + Postgres server (omit --host local)');

  test('connects to live backend over WS via ?spectator=1&host=server with active bots, persists across stack restart, and wipes on &reset=1', async ({ page }) => {
    expectNoPageErrors(page);

    await page.goto('/play.html?spectator=1&host=server&seed=e2e-srv-spec&reset=1&shadow=0&crt=0&wind=0&water=0&reflect=0&pixel=0');
    await waitForTick(page, (t) => t >= 25, 120_000);
    const serverDefault = await page.evaluate(() => {
      const o = (window as unknown as SpectatorWindow).__online!;
      const cols = o.store.latest?.colonies ?? [];
      return {
        spectator: o.spectator && o.store.isSpectator(),
        moveBlocked: o.orderMove(0, 0),
        tick: o.store.tick ?? 0,
        humans: cols.filter((c) => Boolean(c && !c.isBot && c.status !== 'founding')).length,
        bots: cols.filter((c) => Boolean(c && c.isBot)).length,
      };
    });
    expect(serverDefault.spectator).toBe(true);
    expect(serverDefault.moveBlocked).toBe(false);
    expect(serverDefault.humans).toBe(0);
    expect(serverDefault.bots).toBe(2);
    expect(serverDefault.tick).toBeGreaterThanOrEqual(25);
    await expect(page.locator('[data-testid="spectator-panel"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="spectator-bot-0"]')).toBeVisible();
    await expect(page.locator('[data-testid="spectator-bot-1"]')).toBeVisible();
    await assertNoHudOverlap(page);

    // Rerun the backend stack when E2E_CONTROL is active and verify immediate persistence on return
    if (process.env.E2E_CONTROL) {
      await page.goto('about:blank');
      await stack.restartApp();
      await page.goto('/play.html?spectator=1&host=server&seed=e2e-srv-spec&shadow=0&crt=0&wind=0&water=0&reflect=0&pixel=0');
      await expect.poll(async () => page.evaluate(() => Boolean((window as unknown as SpectatorWindow).__online?.store.latest)), { timeout: 120_000 }).toBe(true);
      const tickAfterStackRestart = await page.evaluate(() => (window as unknown as SpectatorWindow).__online!.store.tick ?? 0);
      expect(tickAfterStackRestart).toBeGreaterThanOrEqual(serverDefault.tick);
      await expect(page.locator('[data-testid="spectator-bot-0"]')).toBeVisible();
      await expect(page.locator('[data-testid="spectator-bot-1"]')).toBeVisible();
    }

    // Navigate with &reset=1 -> wipes bots back to fresh start (< serverDefault.tick) and strips reset from location.search
    await page.goto('/play.html?spectator=1&host=server&seed=e2e-srv-spec&reset=1&shadow=0&crt=0&wind=0&water=0&reflect=0&pixel=0');
    await waitForTick(page, (t) => t >= 1, 120_000);
    const tickAfterServerReset = await page.evaluate(() => (window as unknown as SpectatorWindow).__online!.store.tick ?? 0);
    expect(tickAfterServerReset).toBeLessThan(serverDefault.tick);
    expect(await page.evaluate(() => new URLSearchParams(window.location.search).has('reset'))).toBe(false);
    await expect(page.locator('[data-testid="spectator-bot-0"]')).toBeVisible();
    await expect(page.locator('[data-testid="spectator-bot-1"]')).toBeVisible();
    expectNoPageErrors(page);
  });
});

test.describe('Live Server Spectator ?join=<planetId> Inspection', () => {
  test.skip(process.env.E2E_HOST === 'local', 'Requires live NestJS + Postgres server (omit --host local)');

  test('inspects multi-colony live world via ?spectator=1&join=<planetId> with read-only HUD and zero overlap', async ({ page }) => {
    expectNoPageErrors(page);

    // Provision a multi-colony scenario on the live backend and spectate it over /ws with zero player spawn
    const created = await page.request.post('/v1/dev/scenarios/w18');
    expect(created.ok()).toBe(true);
    const { planetId } = (await created.json()) as { planetId: string };
    expect(planetId).toMatch(/^pl_/);

    await page.goto(`/play.html?spectator=1&join=${encodeURIComponent(planetId)}&shadow=0&crt=0&wind=0&water=0&reflect=0&pixel=0`);
    await waitForTick(page, (t) => t >= 1, 120_000);

    await expect(page.locator('[data-testid="spectator-panel"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="spectator-bot-0"]')).toBeVisible();
    await expect(page.locator('[data-testid="spectator-bot-3"]')).toBeVisible();

    await page.locator('[data-testid="spectator-bot-0"]').click();
    const bot0Entity = await page.evaluate(() => (window as unknown as SpectatorWindow).__online!.getSelectedEntityId());
    await page.locator('[data-testid="spectator-bot-3"]').click();
    const bot3State = await page.evaluate(() => {
      const o = (window as unknown as SpectatorWindow).__online!;
      return {
        colonyIndex: o.colonyIndex,
        selectedEntityId: o.getSelectedEntityId(),
        moveBlocked: o.orderMove(1, 0),
      };
    });
    expect(bot3State.colonyIndex).toBe(3);
    expect(bot3State.moveBlocked).toBe(false);
    expect(bot3State.selectedEntityId).not.toBeNull();
    expect(bot3State.selectedEntityId).not.toBe(bot0Entity);

    await expect(page.locator('[data-testid="spectator-bot-3"]')).toHaveAttribute('data-selected', 'true');
    await expect(page.locator('[data-testid="hud-colony-name"]')).toHaveText('Colony D');
    await expect(page.locator('.ta-hq-panel[data-testid="hq-panel"]')).toHaveAttribute('data-entity-id', String(bot3State.selectedEntityId));
    await expect(page.locator('[data-testid="hq-panel-cancel"]')).toBeHidden();
    await page.locator('[data-testid="spectator-tab-summary"]').click();
    await expect(page.locator('[data-testid="spectator-feed"]')).toContainText('#3 · Colony D');
    await expect(page.locator('[data-testid="spectator-feed"]')).toContainText('STOCK · METALS');
    await expect(page.locator('[data-testid="spectator-feed"]')).toContainText('POWER & LOGISTICS');
    await expect(page.locator('[data-testid="spectator-feed"]')).toContainText(/prod \d+ · demand \d+/);

    await page.locator('[data-testid="dock-tab-queue"]').click();
    await expect(page.locator('.ta-queue-panel')).toBeVisible();
    await expect(page.locator('[data-testid="queue-cancel-all"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="queue-cancel-all"]')).toBeHidden();
    await assertNoHudOverlap(page);
    expectNoPageErrors(page);
  });
});
