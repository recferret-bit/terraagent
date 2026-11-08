import { expect, test } from './harness';
import type { Page } from '@playwright/test';
import { registerOrderSteps } from './w13-trade-ui-orders';
import { registerLiveSteps } from './w13-trade-ui-live';
import { closeAndCheck, makeApi, openTrade, previewMath, readPreview, tab, waitReady, whole, type Api, type UiCtx } from './w13-trade-ui-lib';

/**
 * W13 D-45 `/trade.html` UI steps (9f..9r): everything is driven through the real page (clicks and typing, `data-testid`s / roles);
 * REST is used only to set up the other side (A's ask, fixtures) and to read the host's numbers back. Registered inside the serial
 * w13 suite after step 9e (the w13 planet, pages A/B, A's water and B's USDC exist). Balances are read first (earlier steps trade).
 * The suite cleans the books before it starts and leaves them empty (and A's stall fee at 1 %) when it ends.
 */
export function registerTradeUiSteps(ctx: UiCtx): void {
  const api = makeApi(ctx);
  registerSetupSteps(ctx, api);
  registerTicketSteps(ctx, api);
  registerOrderSteps(ctx, api);
  registerLiveSteps(ctx, api);
}

function registerSetupSteps(ctx: UiCtx, api: Api): void {
  test('@hack 9f. /trade.html UI: set-up (empty books, B funded), no identity redirects to the mock login with return=/trade.html and comes back signed in', async ({ browser }) => {
    test.setTimeout(120_000);
    await api.clean();
    const faucet = await fetch(`${ctx.app}/v1/dev/market/faucet`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ planetId: ctx.planetId(), colonyIndex: 1, token: 'USDC', amount: '40' }) });
    expect(faucet.status, 'faucet B').toBe(200);
    // a fresh browser without `?as=`, session or pilot is sent to the mock OAuth page and told where to return
    const page = await (await browser.newContext()).newPage();
    const uncaught: string[] = [];
    page.on('pageerror', (e) => uncaught.push(e.message));
    try {
      await page.goto('/trade.html');
      await page.waitForURL(/\/dev\/mock-oauth/, { timeout: 30_000 });
      const u = new URL(page.url());
      expect(u.searchParams.get('return')).toBe('/trade.html');
      await page.goto(`/trade.html?${new URLSearchParams({ planet: ctx.planetId(), pair: `${ctx.water}/USDC` })}`);
      await page.waitForURL(/\/dev\/mock-oauth/, { timeout: 30_000 });
      expect(new URL(page.url()).searchParams.get('return')).toBe(`/trade.html?planet=${ctx.planetId()}&pair=${encodeURIComponent(`${ctx.water}/USDC`)}`);
      // pick an identity: the mock page returns to the trade page with a token, the page shows who it is
      await page.locator('#mo-name').fill('e2e-ui-human');
      await page.locator('#mo-use').click();
      await page.waitForURL(/\/trade\.html/, { timeout: 30_000 });
      await expect(page.getByRole('tablist').first()).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('#tr-who')).toContainText(/^as /);
      // (a dev identity without a colony on a scenario planet is seated on colony 0 by the backend, so panels load; see the report)
      await expect(page.locator('[data-panel=ticket]')).toBeVisible();
      expect(new URL(page.url()).hash, 'the mock token is removed from the address').toBe('');
      expect(uncaught).toEqual([]);
    } finally {
      await page.context().close();
    }
  });

  test('@hack 9g. /trade.html UI: pickers (planet, resource, quote) and ?planet= / ?pair= drive the page; #board and #orders hash links jump to their panel', async ({ browser }) => {
    test.setTimeout(120_000);
    const page = await openTrade(browser, ctx, 'b');
    try {
      await expect(page.locator('#pk-planet')).toHaveValue(ctx.planetId());
      await expect(page.locator('#pk-base')).toHaveValue(ctx.water);
      await expect(page.locator('#pk-quote')).toHaveValue('USDC');
      await expect(page.locator('#tr-who')).toHaveText('as b');
      // every listed resource is selectable; the choice drives the address and the book
      const bases = await page.locator('#pk-base option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
      expect(bases.length).toBeGreaterThan(1);
      const other = bases.find((b) => b !== ctx.water)!;
      await page.locator('#pk-base').selectOption(other);
      await expect.poll(() => new URL(page.url()).searchParams.get('pair')?.startsWith(`${other}/`), { timeout: 10_000 }).toBe(true);
      await expect(page.locator('#tr-h-market, [data-panel=market] h2').first()).toBeVisible();
      await page.locator('#pk-base').selectOption(ctx.water);
      await expect.poll(() => new URL(page.url()).searchParams.get('pair'), { timeout: 10_000 }).toBe(`${ctx.water}/USDC`);
      expect(new URL(page.url()).searchParams.get('planet')).toBe(ctx.planetId());
      // GO re-opens the planet typed in the picker
      await page.locator('#pk-planet').fill(ctx.planetId());
      await page.getByRole('button', { name: 'GO' }).click();
      await waitReady(page);
      // `?pair=` that is not tradable falls back to the default pair
      await page.goto(`/trade.html?${new URLSearchParams({ as: 'b', planet: ctx.planetId(), pair: 'nope.nothing/USDC' })}`);
      await waitReady(page);
      await expect(page.locator('#pk-base')).toHaveValue(ctx.water);
      // #board scrolls to and marks the price board; #orders opens the All orders tab
      await page.goto(`/trade.html?${new URLSearchParams({ as: 'b', planet: ctx.planetId() })}#board`);
      await waitReady(page);
      await expect(page.locator('[data-panel=board]')).toHaveClass(/is-target/);
      await expect(page.locator('[data-panel=board]')).toBeInViewport();
      await page.goto(`/trade.html?${new URLSearchParams({ as: 'b', planet: ctx.planetId() })}`);
      await waitReady(page);
      await page.getByTestId('tab-keys').click();
      await page.evaluate(() => { location.hash = '#orders'; });
      await expect(page.getByTestId('tab-market')).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('#tr-lower')).toBeInViewport();
    } finally {
      await closeAndCheck(page);
    }
  });

  test('@hack 9g2. /trade.html request budget: <= 20 API requests per load, <= 2 overview calls (no per-pair book fan-out), no polling beyond the 5 s keys tick', async ({ browser }) => {
    test.setTimeout(120_000);
    const page = await openTrade(browser, ctx, 'b');
    try {
      const urls: string[] = [];
      page.on('request', (r) => { const u = new URL(r.url()); if (u.pathname.startsWith('/v1/')) urls.push(`${r.method()} ${u.pathname}`); });
      await page.goto(`/trade.html?${new URLSearchParams({ as: 'b', planet: ctx.planetId(), pair: `${ctx.water}/USDC` })}`);
      await waitReady(page);
      await tab(page, 'pairs');
      await expect(page.locator('[data-panel-body=overview] tbody tr').first()).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(1500);
      const load = urls.length;
      console.log(`[9g2] requests per load (incl. opening All pairs): ${load}`);
      expect(urls.filter((u) => u.includes('/v1/trade/overview/')).length, 'one on load, one when the tab opens').toBeLessThanOrEqual(2);
      expect(urls.filter((u) => /\/v1\/trade\/book\/[^/]+\/[^/]+(\?|$)/.test(u)).length, 'book calls: the selected pair only').toBeLessThanOrEqual(2);
      expect(load).toBeLessThanOrEqual(20);
      urls.length = 0;
      await page.waitForTimeout(10_000);
      console.log(`[9g2] requests in 10 s idle on All pairs: ${urls.length}`);
      expect(urls.length).toBeLessThanOrEqual(10);
    } finally {
      await closeAndCheck(page);
    }
  });
}

/** Limits of the typed ticket: the exact reason under the disabled PLACE button. */
async function expectBlocked(page: Page, amount: string, total: string, reason: RegExp): Promise<void> {
  await page.getByTestId('ticket-amount').fill(amount);
  await page.getByTestId('ticket-total').fill(total);
  await expect(page.getByTestId('ticket-reason')).toHaveText(reason);
  await expect(page.getByTestId('ticket-place')).toBeDisabled();
}

function registerTicketSteps(ctx: UiCtx, api: Api): void {
  test('@hack 9h. /trade.html UI: B sees A\'s new ask live (no reload), a ladder click prefills the ticket, the preview equals the host math and every disabled reason is shown', async ({ browser }) => {
    test.setTimeout(150_000);
    const pol = await api.policy();
    const a = await api.balances('a');
    expect(a.waterFree, 'A holds free water to sell').toBeGreaterThanOrEqual(4n);
    const b = await openTrade(browser, ctx, 'b');
    try {
      await expect(b.getByTestId('ladder-ask')).toHaveCount(0);
      const tot = pol.minUsdc > 8_000_000n ? whole(pol.minUsdc) + 1 : 8;
      const sell = await api.place('a', 'sell', 4, String(tot));
      expect([201, 202], JSON.stringify(sell.json)).toContain(sell.status);
      // SSE: the ask shows in the ladder and in All orders without a reload, not marked YOURS for B
      await expect(b.getByTestId('ladder-ask')).toHaveCount(1, { timeout: 20_000 });
      await expect(b.getByTestId('book-order')).toHaveCount(1, { timeout: 20_000 });
      await expect(b.getByTestId('book-order')).toContainText('ASK');
      await expect(b.getByTestId('book-order')).not.toContainText('YOURS');
      // ladder click -> buy ticket with the level's amount and the exact total
      await b.getByTestId('ladder-ask').click();
      await expect(b.getByTestId('ticket-side-buy')).toHaveAttribute('aria-checked', 'true');
      await expect(b.getByTestId('ticket-amount')).toHaveValue('4');
      expect(Number(await b.getByTestId('ticket-total').inputValue())).toBeCloseTo(tot, 6);
      // preview numbers = notional + platform + stall, max spend from the same function the host reserves with
      const total = BigInt(ctx.usdc(String(tot)));
      let want = previewMath(total, pol.platformFeeBp, pol.stallFeeDefaultBp);
      expect(await readPreview(b)).toEqual(want);
      await b.getByTestId('ticket-stall').fill('1');
      want = previewMath(total, pol.platformFeeBp, 100);
      expect(await readPreview(b)).toEqual(want);
      await expect(b.getByTestId('ticket-reason')).toBeHidden();
      await expect(b.getByTestId('ticket-place')).toBeEnabled();
      // disabled reasons (client-side: nothing is sent)
      const posts: string[] = [];
      b.on('request', (r) => { if (r.method() === 'POST' && r.url().includes('/v1/trade/orders')) posts.push(r.url()); });
      await expectBlocked(b, '', '', /Enter a whole amount/);
      await expectBlocked(b, '0', '8', /Enter a whole amount/);
      await expectBlocked(b, '2.5', '8', /Enter a whole amount/);
      await expectBlocked(b, '4', '', /Enter the TOTAL price/);
      await expectBlocked(b, '4', '-3', /Enter the TOTAL price/);
      if (pol.minUsdc > 1n) await expectBlocked(b, '4', '0.000001', /Below the minimum notional/);
      await expectBlocked(b, '4', '999999', /Not enough free mock USDC/);
      await b.getByTestId('ticket-side-sell').click();
      await expectBlocked(b, '999999', '8', /Not enough free bio\.water/);
      await expect(b.getByTestId('ticket-preview-fees')).toContainText(/paid by the buyer/);
      expect(posts, 'a blocked ticket sends nothing').toEqual([]);
      expect((await api.call('GET', `/orders?planetId=${ctx.planetId()}`, { as: 'b' })).json.orders.filter((o: { state: string }) => o.state === 'OPEN')).toEqual([]);
    } finally {
      await closeAndCheck(b);
    }
  });
}
