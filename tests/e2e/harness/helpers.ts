import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { parseWaves } from '../../../shared/contracts/src/flags/index';
import { OUT } from './ports';

/** `--host local` (runner) sets E2E_HOST=local: suites run the sim-only variant and skip server-only steps. */
export const hostMode = (): 'server' | 'local' => (process.env.E2E_HOST === 'local' ? 'local' : 'server');

/**
 * How many waves the app has on: the stack's `TA_WAVES` (`--waves ..02` boots it with `..02`: 3), else every wave
 * (no `--waves`, or `E2E_REUSE=1`, where the dev stack's own setting is not known here).
 */
export const expectedOnWaves = (): number => parseWaves(process.env.E2E_APP_WAVES ?? '').list.length;

const errorsOf = new WeakMap<Page, string[]>();

function track(page: Page): string[] {
  let list = errorsOf.get(page);
  if (!list) {
    const errs: string[] = [];
    list = errs;
    errorsOf.set(page, errs);
    page.on('pageerror', (e) => errs.push(e.message));
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const url = m.location().url;
      if (/favicon\.ico|fonts\.g(oogleapis|static)\.com/.test(url)) return; // browsers probe favicon unasked; CDN fonts fail offline
      if (url.endsWith('/v1/auth/refresh') && /status of 401/.test(m.text())) return; // a fresh guest has no refresh cookie; auth falls back to guest issuance
      errs.push(url ? `${m.text()} (${url})` : m.text());
    });
  }
  return list;
}

/** W00 session: the dev session name (`?as=<name>`, token `dev:<name>`). JWT login replaces this later. Returns the query fragment. */
export function login(page: Page, name = 'e2e'): string {
  track(page);
  return `as=${encodeURIComponent(name)}`;
}

/** Tick of the newest replica view (`window.__online.store.tick`; the HUD tick chip is gone), or null before the first view. */
export async function readTick(page: Page): Promise<number | null> {
  const t = await page.evaluate(() => {
    const online = (window as unknown as { __online?: { store?: { tick?: number } } }).__online;
    return typeof online?.store?.tick === 'number' ? online.store.tick : -1;
  }).catch(() => -1);
  return t >= 0 ? t : null;
}

/** Waits until the newest view's tick satisfies `minTick` (>=) or the predicate; returns the tick. */
export async function waitForTick(page: Page, until: number | ((tick: number) => boolean), timeout = 15_000): Promise<number> {
  const ok = typeof until === 'number' ? (t: number) => t >= until : until;
  let seen: number | null = null;
  await expect.poll(async () => (seen = await readTick(page)) !== null && ok(seen), { timeout, message: `waiting for tick (last ${seen})` }).toBe(true);
  return seen as unknown as number;
}

/** Opens `/play.html?scenario=<id>&as=<name>&…` and waits for the first view (a tick is known). */
export async function loadScenario(page: Page, id: string, params: Record<string, string> = {}, opts: { as?: string; timeout?: number } = {}): Promise<number> {
  const q = new URLSearchParams({ scenario: id, ...params });
  const [k, v] = login(page, opts.as).split('=');
  q.set(k, decodeURIComponent(v));
  await page.goto(`/play.html?${q}`);
  const tick = await waitForTick(page, () => true, opts.timeout ?? 60_000);
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  if (Number(params.lag) > 0) await page.waitForTimeout(Number(params.lag) + 100);
  return tick;
}

/** Opens `/play.html?host=local&scenario=<id>&…` (the engine runs in the browser; no app needed) and waits for the first view. */
export async function loadLocal(page: Page, scenario = 'w00', params: Record<string, string> = {}, timeout = 60_000): Promise<number> {
  track(page);
  await page.goto(`/play.html?${new URLSearchParams({ host: 'local', scenario, ...params })}`);
  const tick = await waitForTick(page, () => true, timeout);
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  return tick;
}

/** Measures the tick rate (ticks per second) over `ms` of wall time. */
export async function ticksPerSecond(page: Page, ms = 3000): Promise<number> {
  const a = await waitForTick(page, () => true);
  const t0 = Date.now();
  await page.waitForTimeout(ms);
  const b = await waitForTick(page, () => true);
  return ((b - a) * 1000) / (Date.now() - t0);
}

interface OnlineDebug {
  tileToScreen(q: number, r: number): { x: number; y: number } | null;
  lastPick: { q: number; r: number; i: number } | null;
}

/**
 * Clicks the centre of tile (q, r) via `window.__online.tileToScreen`; returns the resulting `__online.lastPick`.
 * The stage toast countdown rewrites its label every 250 ms, so a Playwright click never sees a stable button.
 */
export async function clickTile(page: Page, q: number, r: number): Promise<{ q: number; r: number; i: number } | null> {
  await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>('[data-testid=stage-toast-dismiss]')?.click();
    document.querySelector<HTMLButtonElement>('[data-testid=stage-goals-close]')?.click();
  });
  const pos = await page.evaluate(([a, b]) => (window as unknown as { __online: OnlineDebug }).__online.tileToScreen(a, b), [q, r] as const);
  if (!pos) throw new Error(`clickTile(${q},${r}): terrain is not ready`);
  await page.mouse.click(pos.x, pos.y);
  return page.evaluate(() => (window as unknown as { __online: OnlineDebug }).__online.lastPick);
}

/**
 * DOM contract the dev console must satisfy:
 *   toggle      : key `` ` `` (Backquote)
 *   input       : `[data-testid=dev-console] input`   (Enter submits)
 *   output      : `[data-testid=dev-console-output]`  (one child element per output line, appended in order)
 */
export const CONSOLE = { root: '[data-testid=dev-console]', input: '[data-testid=dev-console] input', output: '[data-testid=dev-console-output]', line: '[data-testid=dev-console-output] > *' } as const;

/** Runs a dev console command; returns the output lines the command added (console is left open). */
export async function devConsole(page: Page, command: string, timeout = 10_000): Promise<string> {
  const input = page.locator(CONSOLE.input);
  if (!(await input.isVisible().catch(() => false))) await page.keyboard.press('Backquote');
  await input.waitFor({ state: 'visible', timeout });
  const lines = page.locator(CONSOLE.line);
  const before = await lines.count();
  await input.fill(command);
  await input.press('Enter');
  await expect.poll(() => lines.count(), { timeout }).toBeGreaterThan(before + 1); // echo plus awaited command response
  const all = await lines.allTextContents();
  return all.slice(before).join('\n');
}

/** Saves `tests/e2e/.out/screenshots/<suite>/<name>.png` (suite = the running spec's file name); returns the path. */
export async function screenshot(page: Page, name: string): Promise<string> {
  const suite = basename(test.info().file).replace(/\.spec\.ts$/, '');
  const dir = resolve(OUT, 'screenshots', suite);
  mkdirSync(dir, { recursive: true });
  const path = resolve(dir, `${name.replace(/[^\w.-]+/g, '-')}.png`);
  await page.screenshot({ path });
  console.log(`[e2e] screenshot ${path}`);
  return path;
}

/** Fails when the page logged an uncaught error or console.error. The prototype `isReady` error is ignored on prototype pages. */
export function expectNoPageErrors(page: Page, opts: { prototype?: boolean } = {}): void {
  const errs = track(page).filter((m) => !(opts.prototype && /isReady/.test(m)));
  expect(errs, 'page errors').toEqual([]);
}
