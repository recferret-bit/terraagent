import type { Browser, Page } from '@playwright/test';
import { maxBuyerSpend } from '../../shared/sim/src/systems/trade/market-fees';
import { expect, expectNoPageErrors, login } from './harness';
import type { TradeStepsCtx } from './w13-trade';

/** Shared helpers of the `/trade.html` UI steps (`w13-trade-ui*.ts`): REST for set-up and read-back, page opening, the preview math. */
export type UiCtx = TradeStepsCtx;
export type Who = 'a' | 'b';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely typed JSON replies
export interface Reply { status: number; json: any }

export function makeApi(ctx: UiCtx) {
  let seq = 0;
  const run = Date.now().toString(36);
  const call = async (method: string, path: string, o: { as?: Who; key?: string; body?: unknown } = {}): Promise<Reply> => {
    const sep = path.includes('?') ? '&' : '?';
    const mutating = method !== 'GET';
    const res = await fetch(`${ctx.app}/v1/trade${path}${o.as ? `${sep}as=${o.as}` : ''}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(o.key ? { authorization: `Bearer ${o.key}` } : {}),
        ...(mutating && (path.startsWith('/orders') || path.startsWith('/stall')) ? { 'idempotency-key': `ui-${run}-${++seq}` } : {}),
      },
      ...(o.body === undefined ? {} : { body: JSON.stringify(o.body) }),
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  };
  const dev = async (name: string, body: unknown): Promise<Reply> => {
    const res = await fetch(`${ctx.app}/v1/dev/commands/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  };
  const place = (as: Who, side: 'buy' | 'sell', amount: number, usdc: string, extra: Record<string, unknown> = {}): Promise<Reply> =>
    call('POST', '/orders', { as, body: { planetId: ctx.planetId(), side, resource: ctx.water, amount, price: { token: 'USDC', amount: ctx.usdc(usdc) }, ttlS: 3600, ...(side === 'buy' ? { maxStallFeeBp: 100 } : {}), ...extra } });
  const balances = async (as: Who): Promise<{ usdcFree: bigint; waterFree: bigint; waterTotal: bigint }> => {
    const b = (await call('GET', `/balances?planetId=${ctx.planetId()}`, { as })).json;
    return { usdcFree: BigInt(b.quote?.USDC?.free ?? '0'), waterFree: BigInt(b.inOrbit?.[ctx.water]?.free ?? '0'), waterTotal: BigInt(b.inOrbit?.[ctx.water]?.total ?? '0') };
  };
  const policy = async (): Promise<{ platformFeeBp: number; stallFeeMaxBp: number; stallFeeDefaultBp: number; minUsdc: bigint }> => {
    const p = (await call('GET', '/policy')).json.policy;
    return { platformFeeBp: p.platformFeeBp, stallFeeMaxBp: p.stallFeeMaxBp, stallFeeDefaultBp: p.stallFeeDefaultBp, minUsdc: BigInt(p.minNotional?.USDC ?? '0') };
  };
  const bookCount = async (): Promise<number> => (await call('GET', `/book/${ctx.planetId()}/${encodeURIComponent(`${ctx.water}/USDC`)}/orders`)).json.orders?.length ?? 0;
  /** Cancels every open order of both identities and every fixture order: each step then starts from an empty water book. */
  const clean = async (): Promise<void> => {
    await dev('market.clear', { planetId: ctx.planetId() });
    for (const as of ['a', 'b'] as const) {
      const open = (await call('GET', `/orders?planetId=${ctx.planetId()}&limit=200`, { as })).json.orders ?? [];
      for (const o of open) if (o.state === 'OPEN' || o.state === 'PARTIAL') await call('DELETE', `/orders/${o.orderId}`, { as });
    }
    await expect.poll(bookCount, { timeout: 30_000, message: 'water/USDC book is empty' }).toBe(0);
  };
  return { call, dev, place, balances, policy, clean, bookCount };
}
export type Api = ReturnType<typeof makeApi>;

export interface OpenOpts { planet?: string; pair?: string; hash?: string; width?: number; height?: number; clipboard?: boolean; track?: boolean }

/** Opens `/trade.html` as `who` in its own context (headless) and waits until the page loaded its panels and the stream is LIVE. */
export async function openTrade(browser: Browser, ctx: UiCtx, who: Who, o: OpenOpts = {}): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: o.width ?? 1280, height: o.height ?? 900 }, ...(o.clipboard ? { permissions: ['clipboard-read', 'clipboard-write'] } : {}) });
  const page = await context.newPage();
  if (o.track !== false) login(page, who);
  const q = new URLSearchParams({ as: who, planet: o.planet ?? ctx.planetId(), pair: o.pair ?? `${ctx.water}/USDC` });
  await page.goto(`/trade.html?${q}${o.hash ?? ''}`);
  await waitReady(page);
  return page;
}

export async function waitReady(page: Page): Promise<void> {
  await expect(page.getByRole('tablist').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('trade-conn')).toHaveAttribute('data-conn', 'live', { timeout: 30_000 });
  await expect(page.locator('[data-panel-body=balances]')).toContainText(/Your colony on/, { timeout: 30_000 });
  await expect(page.locator('[data-panel-body=book]')).not.toContainText('Loading', { timeout: 30_000 });
}

export const tab = async (page: Page, id: 'market' | 'pairs' | 'orders' | 'fills' | 'keys'): Promise<void> => {
  await page.getByTestId(`tab-${id}`).click();
  await expect(page.getByTestId(`tab-${id}`)).toHaveAttribute('aria-selected', 'true');
};

/** Asserts the page logged no uncaught error / console.error, then closes its context. */
export async function closeAndCheck(page: Page): Promise<void> {
  try { expectNoPageErrors(page); } finally { await page.context().close(); }
}

/** Number in the text of a display amount (`"10.20 mock USDC"` -> 10.2). */
export const num = (text: string | null): number => Number((text ?? '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)?.[0] ?? NaN);
export const whole = (atomic: bigint): number => Number(atomic) / 1_000_000;

/** The ticket's preview as the host computes it: notional, platform fee, stall fee (both floor of bp) and the exact reserved max spend. */
export function previewMath(totalAtomic: bigint, platformBp: number, stallBp: number): { notional: number; platform: number; stall: number; max: number } {
  return {
    notional: whole(totalAtomic),
    platform: whole((totalAtomic * BigInt(platformBp)) / 10_000n),
    stall: whole((totalAtomic * BigInt(stallBp)) / 10_000n),
    max: whole(maxBuyerSpend(totalAtomic, platformBp, stallBp)),
  };
}

export async function readPreview(page: Page): Promise<Record<'notional' | 'platform' | 'stall' | 'max', number>> {
  const get = async (k: string): Promise<number> => num(await page.getByTestId(`ticket-preview-${k}`).textContent());
  return { notional: await get('notional'), platform: await get('platform'), stall: await get('stall'), max: await get('max') };
}
