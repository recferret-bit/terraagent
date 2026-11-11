import type { Browser, BrowserContext, Page } from '@playwright/test';
import { expect, hostMode, login, test, waitForTick } from './harness';
import { independentBrowser } from './harness/independentBrowser';

export const FEE_METALS = 4000;
export const CARGO_METALS = 1000;
export const FUND_METALS = 500;
export const BOUNTY_METALS = 200;
export const HIRE_METALS = 200;

const HIVE_KIND = 63;
const RECON_KIND = 51;
const MERC_OWNER = -2;
const STRIDE = 13;

export const serverOnly = (): void => {
  test.skip(hostMode() === 'local', 'needs the app (server host)');
};

export async function dismissOverlays(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>('[data-testid=stage-toast-dismiss]')?.click();
    document.querySelector<HTMLButtonElement>('[data-testid=stage-goals-close]')?.click();
  });
}

export async function closeDevConsole(page: Page): Promise<void> {
  const input = page.locator('[data-testid=dev-console] input');
  if (await input.isVisible().catch(() => false)) await page.keyboard.press('Backquote');
}

export async function openPlanetItem(page: Page, id: 'council' | 'bounties'): Promise<void> {
  await dismissOverlays(page);
  await closeDevConsole(page);
  for (const closeId of ['council-close', 'bounty-close']) {
    const close = page.getByTestId(closeId);
    if (await close.isVisible().catch(() => false)) await close.click();
  }
  const item = page.getByTestId(`planet-menu-${id}`);
  if (!(await item.isVisible().catch(() => false))) await page.getByTestId('planet-menu-toggle').click();
  await item.click();
}

export async function cargoMetals(page: Page, asName: string): Promise<number> {
  return page.evaluate(async (token) => {
    const res = await fetch('/v1/near/cargo', { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) return -res.status;
    const body = (await res.json()) as { inOrbit?: { 'metals.t1'?: number } };
    return body.inOrbit?.['metals.t1'] ?? 0;
  }, `dev:${asName}`);
}

export async function hiveId(page: Page): Promise<number> {
  const ids = await page.evaluate((kind) => {
    const view = (window as unknown as { __online?: { store?: { latest?: { entities?: Float32Array; count?: number } } } }).__online?.store?.latest;
    if (!view?.entities || typeof view.count !== 'number') return [] as number[];
    const found: number[] = [];
    for (let i = 0; i < view.count; i++) {
      if (view.entities[i * 13 + 1] === kind) found.push(view.entities[i * 13] ?? 0);
    }
    return found;
  }, HIVE_KIND);
  const id = ids[0];
  if (!id) throw new Error('no living black-ant hive in the replica');
  return id;
}

export async function mercCount(page: Page): Promise<number> {
  return page.evaluate(({ kind, owner, stride }) => {
    const view = (window as unknown as { __online?: { store?: { latest?: { entities?: Float32Array; count?: number } } } }).__online?.store?.latest;
    if (!view?.entities || typeof view.count !== 'number') return 0;
    let n = 0;
    for (let i = 0; i < view.count; i++) {
      if (view.entities[i * stride + 1] === kind && view.entities[i * stride + 2] === owner) n += 1;
    }
    return n;
  }, { kind: RECON_KIND, owner: MERC_OWNER, stride: STRIDE });
}

export function planetIdFrom(text: string): string {
  const id = text.match(/planet (pl_[A-Za-z0-9]+)/)?.[1];
  if (!id) throw new Error(`no planet id in:\n${text}`);
  return id;
}

export async function voteYesOnOpen(page: Page): Promise<void> {
  const row = page.locator('[data-testid^="council-proposal-"]').filter({ hasText: 'InProgress' }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.locator('[data-testid^="council-vote-yes-"]').click();
}

export async function openSecondColony(
  browser: Browser,
  planetId: string,
  asName: string,
): Promise<{ context: BrowserContext; page: Page; close: () => Promise<void> }> {
  const opened = await independentBrowser(browser, {}, 'w22-b');
  const page = await opened.context.newPage();
  login(page, asName);
  const q = new URLSearchParams({ join: planetId, as: asName, skip: '1' });
  await page.goto(`/play.html?${q}`);
  try {
    await waitForTick(page, () => true, 120_000);
  } catch (err) {
    const text = await page.locator('body').innerText().catch(() => '');
    await opened.close(true);
    throw new Error(`join ${page.url()} did not tick\n${text.slice(0, 400)}`, { cause: err });
  }
  await expect.poll(() => cargoMetals(page, asName), { timeout: 30_000 }).toBe(CARGO_METALS);
  return { context: opened.context, page, close: () => opened.close() };
}
