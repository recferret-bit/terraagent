import type { Page } from '@playwright/test';
import { expect, test } from './harness';
import { closeAndCheck, num, openTrade, tab, whole, type Api, type UiCtx } from './w13-trade-ui-lib';

/** Order flow through the page: place / cancel / cancel-all, a crossing buy with its fill and receipt, SUGGEST, fixtures. */

/** Total (whole USDC) of the standard 4-unit test ask: 2 USDC per unit, or above the minimum notional. */
async function askTotal(api: Api): Promise<number> {
  const min = (await api.policy()).minUsdc;
  return min > 8_000_000n ? whole(min) + 1 : 8;
}

async function placeFromTicket(page: Page, side: 'buy' | 'sell', amount: number, total: number): Promise<void> {
  await page.getByTestId(`ticket-side-${side}`).click();
  await page.getByTestId('ticket-amount').fill(String(amount));
  await page.getByTestId('ticket-total').fill(String(total));
  await expect(page.getByTestId('ticket-place')).toBeEnabled();
  await page.getByTestId('ticket-place').click();
  await expect(page.getByTestId('ticket-result')).toContainText(/accepted|Sent to the sim/, { timeout: 30_000 });
}

export function registerOrderSteps(ctx: UiCtx, api: Api): void {
  step0(ctx, api);
  step1(ctx, api);
  step2(ctx, api);
  step3(ctx, api);
}

function step0(ctx: UiCtx, api: Api): void {
  test('@hack 9i. /trade.html UI: A\'s own ask shows under My orders and as YOURS in All orders; CANCEL removes it; two UI placements go away with CANCEL ALL', async ({ browser }) => {
    test.setTimeout(180_000);
    const tot = await askTotal(api);
    const a = await openTrade(browser, ctx, 'a');
    try {
      // the ask A's colony placed earlier (9h, over REST) is listed in both tables
      await tab(a, 'orders');
      await expect(a.getByTestId('my-order')).toHaveCount(1, { timeout: 20_000 });
      await expect(a.getByTestId('my-order')).toHaveAttribute('data-state', 'OPEN');
      await expect(a.getByTestId('my-order')).toContainText(/SELL/);
      await tab(a, 'market');
      await expect(a.locator('[data-testid=book-order][data-mine="1"]')).toHaveCount(1);
      await expect(a.getByTestId('book-order')).toContainText('YOURS');
      await tab(a, 'orders');
      const cancelledId = (await a.getByTestId('my-order').getAttribute('data-order')) ?? '';
      await a.getByTestId('my-order-cancel').click();
      await expect(a.getByTestId('my-order')).toHaveCount(0, { timeout: 20_000 });
      await a.getByTestId('orders-filter-cancelled').click();
      await expect(a.locator(`[data-testid=my-order][data-order="${cancelledId}"]`)).toHaveAttribute('data-state', 'CANCELLED');
      await a.getByTestId('orders-filter-open').click();
      await expect.poll(() => api.bookCount(), { timeout: 20_000 }).toBe(0);
      // place two asks through the ticket; both appear (live) in My orders and as YOURS in All orders
      await placeFromTicket(a, 'sell', 4, tot);
      await placeFromTicket(a, 'sell', 3, tot - 2);
      await expect(a.getByTestId('my-order')).toHaveCount(2, { timeout: 30_000 });
      await expect(a.getByTestId('orders-cancel-all')).toHaveText('CANCEL ALL (2)');
      await tab(a, 'market');
      await expect(a.locator('[data-testid=book-order][data-mine="1"]')).toHaveCount(2, { timeout: 20_000 });
      await tab(a, 'orders');
      await a.getByTestId('orders-cancel-all').click();
      await expect(a.getByTestId('my-order')).toHaveCount(0, { timeout: 30_000 });
      await expect(a.getByTestId('orders-cancel-all')).toBeDisabled();
      await expect.poll(() => api.bookCount(), { timeout: 20_000 }).toBe(0);
      // leave one ask resting for the next step
      await placeFromTicket(a, 'sell', 4, tot);
      await expect(a.getByTestId('my-order')).toHaveCount(1, { timeout: 30_000 });
    } finally {
      await closeAndCheck(a);
    }
  });
}

function step1(ctx: UiCtx, api: Api): void {
  test('@hack 9j. /trade.html UI: B\'s crossing buy fills A\'s ask: My fills shows notional, platform fee and stall fee, settles FINAL, and the receipt link opens the explorer', async ({ browser }) => {
    test.setTimeout(240_000);
    const pol = await api.policy();
    const tot = await askTotal(api);
    const before = await api.balances('b');
    const seen = new Set((((await api.call('GET', `/fills?planetId=${ctx.planetId()}&limit=100`, { as: 'b' })).json.fills ?? []) as Array<{ tradeId: string }>).map((f) => f.tradeId));
    const b = await openTrade(browser, ctx, 'b');
    try {
      await expect(b.getByTestId('ladder-ask')).toHaveCount(1, { timeout: 20_000 });
      await b.getByTestId('ladder-ask').click();
      await b.getByTestId('ticket-stall').fill('1');
      await b.getByTestId('ticket-place').click();
      await expect(b.getByTestId('ticket-result')).toContainText(/accepted|Sent to the sim/, { timeout: 30_000 });
      await tab(b, 'fills');
      // earlier steps left fills of B: the new one is the trade id that was not there before
      let fresh = '';
      await expect.poll(async () => {
        const now = ((await api.call('GET', `/fills?planetId=${ctx.planetId()}&limit=100`, { as: 'b' })).json.fills ?? []) as Array<{ tradeId: string }>;
        fresh = now.find((f) => !seen.has(f.tradeId))?.tradeId ?? '';
        return fresh;
      }, { timeout: 60_000, message: 'B has a new fill' }).not.toBe('');
      const row = b.locator(`[data-testid=my-fill][data-trade="${fresh}"]`);
      await expect(row).toHaveCount(1, { timeout: 30_000 });
      const cells = row.locator('td');
      await expect(cells.nth(1)).toHaveText('BUY');
      await expect(cells.nth(3)).toHaveText('4');
      const platform = whole((BigInt(Math.round(tot * 1e6)) * BigInt(pol.platformFeeBp)) / 10_000n);
      const stall = whole((BigInt(Math.round(tot * 1e6)) * 100n) / 10_000n);
      expect(num(await cells.nth(4).textContent())).toBeCloseTo(tot, 6);
      expect(num(await cells.nth(5).textContent())).toBeCloseTo(platform, 6);
      expect(num(await cells.nth(6).textContent())).toBeCloseTo(stall, 6);
      await expect(cells.nth(6)).toContainText('(1.00 %)');
      await expect(cells.nth(7)).toHaveText(/player/i);
      await expect(cells.nth(8)).toHaveText('FINAL', { timeout: 120_000 });
      // the receipt link opens the chain explorer receipt page in a new tab
      const link = row.getByTestId('fill-receipt');
      await expect(link).toBeVisible({ timeout: 30_000 });
      const href = (await link.getAttribute('href')) ?? '';
      expect(href).toMatch(/^\/dev\/chain\/tx\/.+/);
      const [popup] = await Promise.all([b.context().waitForEvent('page'), link.click()]);
      await popup.waitForLoadState('domcontentloaded');
      expect(new URL(popup.url()).pathname).toBe(href);
      await expect(popup.locator('body')).toContainText(/receipt/i, { timeout: 30_000 });
      await popup.close();
      // B paid notional + platform + stall exactly once; A's ask is gone from the book
      const after = await api.balances('b');
      expect(before.usdcFree - after.usdcFree).toBe(BigInt(Math.round((tot + platform + stall) * 1e6)));
      await expect.poll(() => api.bookCount(), { timeout: 20_000 }).toBe(0);
    } finally {
      await closeAndCheck(b);
    }
  });
}

function step2(ctx: UiCtx, api: Api): void {
  test('@hack 9k. /trade.html UI: SUGGEST only prefills the ticket (no order request is sent)', async ({ browser }) => {
    test.setTimeout(120_000);
    const a = await openTrade(browser, ctx, 'a');
    try {
      const posts: string[] = [];
      a.on('request', (r) => { if (r.method() === 'POST' && r.url().includes('/v1/trade/orders')) posts.push(r.url()); });
      const openBefore = ((await api.call('GET', `/orders?planetId=${ctx.planetId()}`, { as: 'a' })).json.orders as Array<{ state: string }>).filter((o) => o.state === 'OPEN').length;
      await a.getByTestId('ticket-side-sell').click();
      await expect(a.getByTestId('ticket-amount')).toHaveValue('');
      await a.getByTestId('ticket-cost').fill('0.5');
      await a.getByTestId('ticket-suggest').click();
      await expect(a.getByTestId('ticket-suggest-msg')).toContainText(/Prefilled|No sell suggestion/, { timeout: 30_000 });
      test.info().annotations.push({ type: 'observed', description: `SUGGEST: ${await a.getByTestId('ticket-suggest-msg').innerText()}` });
      await expect(a.getByTestId('ticket-suggest-msg')).toContainText('Prefilled');
      expect(Number(await a.getByTestId('ticket-amount').inputValue())).toBeGreaterThan(0);
      expect(Number(await a.getByTestId('ticket-total').inputValue())).toBeGreaterThan(0);
      await a.waitForTimeout(1500);
      expect(posts, 'SUGGEST sends no order').toEqual([]);
      const openAfter = ((await api.call('GET', `/orders?planetId=${ctx.planetId()}`, { as: 'a' })).json.orders as Array<{ state: string }>).filter((o) => o.state === 'OPEN').length;
      expect(openAfter).toBe(openBefore);
    } finally {
      await closeAndCheck(a);
    }
  });
}

function step3(ctx: UiCtx, api: Api): void {
  test('@hack 9l. /trade.html UI: market.seed fixtures carry the FIXTURE badge, the Asks / Bids filter narrows the table, a bid click prefills a sell, market.clear empties it live', async ({ browser }) => {
    test.setTimeout(150_000);
    const pairs = ((await api.call('GET', '/pairs')).json.pairs ?? []) as Array<{ pair: string }>;
    const pair = (pairs.find((p) => p.pair !== `${ctx.water}/USDC` && p.pair.endsWith('/USDC')) ?? pairs.find((p) => p.pair !== `${ctx.water}/USDC`))!.pair;
    const seeded = await api.dev('market.seed', { planetId: ctx.planetId(), pair });
    expect(seeded.status, JSON.stringify(seeded.json)).toBeLessThan(300);
    const b = await openTrade(browser, ctx, 'b', { pair });
    try {
      const rows = b.getByTestId('book-order');
      await expect(rows).toHaveCount(10, { timeout: 30_000 });
      await expect(b.locator('[data-testid=book-order][data-actor=fixture]')).toHaveCount(10);
      await expect(rows.first().locator('.tr-badge-fixture')).toHaveText(/fixture/i);
      await expect(b.locator('[data-actor-count=fixture]')).toBeVisible();
      await b.getByTestId('market-filter-sell').click();
      await expect(rows).toHaveCount(5);
      for (const t of await rows.locator('td:first-child').allInnerTexts()) expect(t).toMatch(/^ASK/);
      await b.getByTestId('market-filter-buy').click();
      await expect(rows).toHaveCount(5);
      for (const t of await rows.locator('td:first-child').allInnerTexts()) expect(t).toMatch(/^BID/);
      await b.getByTestId('market-filter-all').click();
      await expect(rows).toHaveCount(10);
      // a bid level click means "sell into it": the sell ticket gets the level's amount
      await b.getByTestId('ladder-bid').first().click();
      await expect(b.getByTestId('ticket-side-sell')).toHaveAttribute('aria-checked', 'true');
      expect(Number(await b.getByTestId('ticket-amount').inputValue())).toBeGreaterThan(0);
      expect((await api.dev('market.clear', { planetId: ctx.planetId() })).status).toBeLessThan(300);
      await expect(rows).toHaveCount(0, { timeout: 30_000 });
      await expect(b.locator('[data-panel-body=market]')).toContainText(/No resting orders/);
    } finally {
      await closeAndCheck(b);
    }
  });
}
