import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { OUT } from './ports';

/** `--host local` (runner) sets E2E_HOST=local: suites run the sim-only variant and skip server-only steps. */
export const hostMode = (): 'server' | 'local' => (process.env.E2E_HOST === 'local' ? 'local' : 'server');

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
      if (/favicon\.ico/.test(url)) return; // browsers probe it unasked
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

/** Tick shown by the HUD chip (`TICK n`), or null while it shows the dash. */
export async function readTick(page: Page): Promise<number | null> {
  const t = await page.locator('.ta-tick__n').first().textContent({ timeout: 2000 }).catch(() => null);
  return t !== null && /^\d+$/.test(t.trim()) ? Number(t) : null;
}

/** Waits until the tick chip satisfies `minTick` (>=) or the predicate; returns the tick. */
export async function waitForTick(page: Page, until: number | ((tick: number) => boolean), timeout = 15_000): Promise<number> {
  const ok = typeof until === 'number' ? (t: number) => t >= until : until;
  let seen: number | null = null;
  await expect.poll(async () => (seen = await readTick(page)) !== null && ok(seen), { timeout, message: `waiting for tick (last ${seen})` }).toBe(true);
  return seen as unknown as number;
}

/** Opens `/play.html?scenario=<id>&as=<name>&…` and waits for the first view (tick chip shows a number). */
export async function loadScenario(page: Page, id: string, params: Record<string, string> = {}, opts: { as?: string; timeout?: number } = {}): Promise<number> {
  const q = new URLSearchParams({ scenario: id, ...params });
  const [k, v] = login(page, opts.as).split('=');
  q.set(k, decodeURIComponent(v));
  await page.goto(`/play.html?${q}`);
  return waitForTick(page, () => true, opts.timeout ?? 30_000);
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

/** Clicks the centre of tile (q, r) via `window.__online.tileToScreen`; returns the resulting `__online.lastPick`. */
export async function clickTile(page: Page, q: number, r: number): Promise<{ q: number; r: number; i: number } | null> {
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
  await expect.poll(() => lines.count(), { timeout }).toBeGreaterThan(before);
  await page.waitForTimeout(150); // let a command that prints in several lines finish
  const all = await lines.allTextContents();
  return all.slice(before).join('\n');
}

/** Saves `e2e/.out/screenshots/<suite>/<name>.png` (suite = the running spec's file name); returns the path. */
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
