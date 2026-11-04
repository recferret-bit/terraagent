import type { BrowserContext, Page } from '@playwright/test';
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
 * W10 Cargo & Trade Hub (F1, mock) — Wave E2E suite covering demo steps 1–9
 * (`docs/plan/waves/W10-cargo-trade-hub.md` § Demo story & W10-30).
 * Every step is tagged `@hack` for `npm run e2e -- --waves ..10 --hack`.
 */
test.describe.configure({ mode: 'serial' });

const local = hostMode() === 'local';

interface OnlineColonyView {
  id?: string;
  stock?: Record<string, number>;
  caps?: Record<string, number>;
  power?: {
    supply?: number;
    demand?: number;
    net?: number;
    brownout?: boolean;
    offlineReasons?: Record<string, string>;
  };
  cargo?: {
    inOrbit?: Record<string, number>;
    pendingMint?: Record<string, unknown>;
    pendingImport?: Record<string, unknown>;
  };
}

interface OnlineDebugWindow {
  __online: {
    entities?: {
      entries?: Map<number, { kind: number; state: number; q: number; r: number; mesh: { visible: boolean } }>;
    };
    store: {
      latest: {
        tick: number;
        count: number;
        entities: Float32Array;
        colonies: OnlineColonyView[];
      } | null;
    };
    commands: {
      send(kind: string, args?: unknown): Promise<{ ok: boolean; appliedAtTick?: number; code?: string; detail?: string }>;
    };
  };
}

let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
});

test.afterAll(async () => {
  await context?.close();
});

async function openW10(target: Page, params: Record<string, string> = {}): Promise<void> {
  if (local) {
    await loadLocal(target, 'w10', params, 45_000);
  } else {
    await loadScenario(target, 'w10', params, { as: 'w10', timeout: 45_000 });
  }
}

const getColony0 = (target: Page) =>
  target.evaluate(() => (window as unknown as OnlineDebugWindow).__online.store.latest?.colonies?.[0] ?? null);

const sendSimCmd = (target: Page, kind: string, args: unknown) =>
  target.evaluate(([k, a]) => (window as unknown as OnlineDebugWindow).__online.commands.send(k, a), [kind, args] as const);

async function runConsole(target: Page, command: string): Promise<string> {
  const lines = target.locator('[data-testid=dev-console-output] > *');
  const before = await lines.count().catch(() => 0);
  await devConsole(target, command);
  await expect.poll(async () => await lines.count(), { timeout: 10_000 }).toBeGreaterThanOrEqual(before + 2);
  const all = await lines.allTextContents();
  const input = target.locator('[data-testid=dev-console] input');
  if (await input.isVisible().catch(() => false)) {
    await input.press('Escape');
  }
  return all.slice(before).join('\n');
}

async function setInputAmount(target: Page, amount: number): Promise<void> {
  const input = target.locator('[data-testid="trade-hub-amount-input"]');
  await input.fill(String(amount));
  await input.dispatchEvent('change');
}

test('@hack 1. Open ?scenario=w10 -> S2 colony with 900 metals.t1 stock, online Trade Hub T1 at (2,1), and powered storage', async () => {
  await openW10(page);
  await expect.poll(async () => (await getColony0(page))?.stock?.['metals.t1'] ?? 0).toBe(900);
  const col = await getColony0(page);
  expect(col?.stock).toMatchObject({
    'metals.t1': 900,
    'minerals.t1': 400,
    'bio.water': 300,
    'bio.biomass': 200,
  });
  expect(col?.caps?.metals).toBeGreaterThanOrEqual(1500);
  expect(col?.power).toMatchObject({
    supply: 29,
    demand: 19,
    net: 10,
    brownout: false,
  });

  const hasHub = await page.evaluate(() => {
    const s = (window as unknown as OnlineDebugWindow).__online.store.latest;
    if (!s) return false;
    for (let i = 0; i < s.count; i++) {
      if (s.entities[i * 12 + 1] === 8 && s.entities[i * 12 + 3] === 2 && s.entities[i * 12 + 4] === 1) {
        return true;
      }
    }
    return false;
  });
  expect(hasHub).toBe(true);
  await expect(page.locator('[data-building="tradeHub"]')).toBeVisible();
  await screenshot(page, '1-w10-colony-loaded');
  expectNoPageErrors(page);
});

test('@hack 2. Click the Trade Hub -> Trade Hub panel opens on Export showing Cargo in orbit: 0', async () => {
  await clickTile(page, 2, 1);
  const panel = page.locator('[data-testid="trade-hub-panel"]');
  await expect(panel).toHaveAttribute('data-open', 'true');
  await expect(panel).toHaveAttribute('data-tab', 'export');
  await expect(panel).toHaveAttribute('data-online', 'true');
  await expect(page.locator('[data-testid="trade-hub-tier"]')).toHaveText('TIER 1');
  await expect(page.locator('[data-testid="trade-hub-status"]')).toHaveText('ONLINE');
  await expect(page.locator('[data-testid="orbit-value-metals.t1"]')).toHaveText('0');
  await expect(page.locator('[data-testid="trade-hub-throughput-val"]')).toHaveText('0 / 250 / min');
  await screenshot(page, '2-trade-hub-panel-open');
  expectNoPageErrors(page);
});

test('@hack 3 & 4. Export 250 metals.t1 -> stock drops immediately, Loading cargo chip shows, then settles to 250 in orbit and mt_mint in /dev/chain/', async () => {
  if (!local) {
    await runConsole(page, 'near.mock.latency cargo 200 300');
  }
  await setInputAmount(page, 250);
  await expect(page.locator('[data-testid="trade-hub-preview"]')).toContainText('Export 250 Metals T1 → Orbit');
  await page.locator('[data-testid="trade-hub-confirm"]').click();

  await expect.poll(async () => (await getColony0(page))?.stock?.['metals.t1'] ?? 900).toBe(650);
  await expect(page.locator('[data-testid="trade-hub-chip-export"]')).toContainText('Loading cargo…');

  await expect(page.locator('[data-testid="orbit-value-metals.t1"]')).toHaveText('250', { timeout: 20_000 });
  await expect(page.locator('[data-testid="trade-hub-throughput-val"]')).toHaveText('250 / 250 / min');
  await expect(page.locator('[data-testid="trade-hub-daily-cap-val"]')).toHaveText('250 / 20,000 / day');

  if (!local) {
    await runConsole(page, 'near.mock.latency cargo 0 0');
    const explorer = await context.newPage();
    await explorer.goto('/dev/chain/');
    const receiptsTab = explorer.getByRole('tab', { name: 'RECEIPTS' });
    await expect(receiptsTab).toBeVisible({ timeout: 15_000 });
    await receiptsTab.click();
    const link = explorer.locator('tr', { hasText: 'mt_mint' }).locator('a.hash-link', { hasText: 'mock:' }).first();
    await expect(link).toBeVisible({ timeout: 15_000 });
    await link.click();
    await expect(explorer).toHaveURL(/\/dev\/chain\/tx\//, { timeout: 15_000 });
    await expect(explorer.locator('body')).toContainText('minter.terraagent.mock');
    await expect(explorer.locator('body')).toContainText('res.terraagent.mock');
    await explorer.close();
  }
  await screenshot(page, '4-export-settled');
  expectNoPageErrors(page);
});

test('@hack 5. Export more within the same minute at T1 throughput (250/min) -> clamped/rejected mint_cap with countdown; cargo.cap.reset clears it', async () => {
  await expect(page.locator('[data-testid="trade-hub-limit-reason"]')).toContainText('Throughput cap reached (250 / min)');
  const res = await sendSimCmd(page, 'cargo.export', { resource: 'metals.t1', amount: 50 });
  expect(res.ok).toBe(false);
  expect(res.code).toBe('mint_cap');
  await expect(page.locator('[data-testid="trade-hub-toast"]')).toBeVisible();
  await expect(page.locator('[data-testid="trade-hub-toast"]')).toHaveAttribute('data-code', 'mint_cap');
  await expect(page.locator('[data-testid="trade-hub-toast"]')).toContainText('retry in');
  await screenshot(page, '5-throughput-cap-reached');

  const out = await runConsole(page, 'cargo.cap.reset 0');
  expect(out).toContain('Reset cargo mint caps for colony 0');
  await expect(page.locator('[data-testid="trade-hub-throughput-val"]')).toHaveText('0 / 250 / min');
  expectNoPageErrors(page);
});

test('@hack 6. Switch to Import and import 150 metals.t1 -> after burn settles, stock rises to 800, in-orbit drops to 100, and /dev/chain/ shows mt_burn', async () => {
  await page.locator('[data-testid="trade-hub-tab-import"]').click();
  await expect(page.locator('[data-testid="trade-hub-panel"]')).toHaveAttribute('data-tab', 'import');

  await setInputAmount(page, 150);
  await expect(page.locator('[data-testid="trade-hub-preview"]')).toContainText('Import 150 Metals T1 → Colony');
  await page.locator('[data-testid="trade-hub-confirm"]').click();

  await expect.poll(async () => (await getColony0(page))?.stock?.['metals.t1'] ?? 0, { timeout: 20_000 }).toBe(800);
  await expect(page.locator('[data-testid="orbit-value-metals.t1"]')).toHaveText('100', { timeout: 20_000 });

  if (!local) {
    const explorer = await context.newPage();
    await explorer.goto('/dev/chain/');
    await explorer.getByRole('tab', { name: 'RECEIPTS' }).click();
    await expect(explorer.locator('tr', { hasText: 'mt_burn' }).first()).toBeVisible({ timeout: 15_000 });
    await explorer.close();
  }
  await screenshot(page, '6-import-settled');
  expectNoPageErrors(page);
});

test('@hack 7. near.mock.fail cargo 1, then export 50 metals.t1 -> fails and refunds 50 metals.t1 to stock with refund toast; near.mock.fail cargo 0 restores', async () => {
  test.setTimeout(60_000);
  await page.locator('[data-testid="trade-hub-tab-export"]').click();
  await runConsole(page, 'cargo.cap.reset 0');
  const failOut = await runConsole(page, 'near.mock.fail cargo 1');
  expect(failOut).toContain('fail rate for cargo is 1');

  try {
    await setInputAmount(page, 50);
    await page.locator('[data-testid="trade-hub-confirm"]').click();
    await expect(page.locator('[data-testid="trade-hub-toast"]')).toContainText(
      'Orbit transfer failed — 50 Metals T1 returned to stock',
      { timeout: 30_000 },
    );
    await expect.poll(async () => (await getColony0(page))?.stock?.['metals.t1'] ?? 0, { timeout: 15_000 }).toBe(800);
    await expect(page.locator('[data-testid="orbit-value-metals.t1"]')).toHaveText('100');
    await screenshot(page, '7-export-failed-refund');
  } finally {
    const restoreOut = await runConsole(page, 'near.mock.fail cargo 0');
    expect(restoreOut).toContain('fail rate for cargo is 0');
  }
  expectNoPageErrors(page);
});

test('@hack 8. Cut power (time night) so Trade Hub is shed -> Export button disables with Trade Hub offline; skipnight restores', async () => {
  await runConsole(page, 'time night');
  await expect.poll(async () => (await getColony0(page))?.power?.brownout ?? false).toBe(true);
  await expect(page.locator('[data-testid="trade-hub-status"]')).toHaveAttribute('data-online', 'false');
  await expect(page.locator('[data-testid="trade-hub-status"]')).toContainText('OFFLINE');
  await expect(page.locator('[data-testid="trade-hub-offline-banner"]')).toBeVisible();
  await expect(page.locator('[data-testid="trade-hub-confirm"]')).toBeDisabled();
  await expect(page.locator('[data-testid="trade-hub-confirm"]')).toHaveAttribute('data-disabled-reason', 'hub_offline');
  await screenshot(page, '8-hub-offline-brownout');

  await runConsole(page, 'skipnight');
  await expect.poll(async () => (await getColony0(page))?.power?.brownout ?? true).toBe(false);
  await expect(page.locator('[data-testid="trade-hub-status"]')).toHaveAttribute('data-online', 'true');
  expectNoPageErrors(page);
});

test('@hack 9. Flag-off check (?waves=..09) -> Trade Hub hidden from Construction menu and scene, panel absent, cargo commands rejected with wave_disabled', async () => {
  test.setTimeout(120_000);
  if (!local) {
    await loadScenario(page, 'w10', { waves: '..09' }, { as: 'w10-off', timeout: 45_000 });
    await expect(page.locator('[data-building="tradeHub"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="trade-hub-panel"]')).toHaveCount(0);
    const serverMeshVis = await page.evaluate(() => {
      const win = window as unknown as OnlineDebugWindow;
      for (const entry of win.__online.entities?.entries?.values() ?? []) {
        if (entry.kind === 8) return entry.mesh.visible;
      }
      return null;
    });
    expect(serverMeshVis).toBe(false);
  }

  // Local engine with waves=..09 (sim + UI both run with ..09: existing hub is inert & hidden, cargo.export -> wave_disabled)
  await loadLocal(page, 'w10', { waves: '..09' }, 45_000);
  await expect(page.locator('[data-building="tradeHub"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="trade-hub-panel"]')).toHaveCount(0);

  const hubState = await page.evaluate(() => {
    const win = window as unknown as OnlineDebugWindow;
    const s = win.__online.store.latest;
    let state = -1;
    if (s) {
      for (let i = 0; i < s.count; i++) {
        if (s.entities[i * 12 + 1] === 8) state = s.entities[i * 12 + 10];
      }
    }
    let meshVisible: boolean | null = null;
    for (const entry of win.__online.entities?.entries?.values() ?? []) {
      if (entry.kind === 8) meshVisible = entry.mesh.visible;
    }
    return { state, meshVisible };
  });
  expect(hubState.state).toBe(6); // ENTITY_STATE.inert
  expect(hubState.meshVisible).toBe(false);

  const rej = await sendSimCmd(page, 'cargo.export', { resource: 'metals.t1', amount: 10 });
  expect(rej.ok).toBe(false);
  expect(rej.code).toBe('wave_disabled');
  await screenshot(page, '9-waves-09-flag-off');
  expectNoPageErrors(page);
});
