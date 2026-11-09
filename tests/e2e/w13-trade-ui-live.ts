import type { Page } from '@playwright/test';
import { expect, test } from './harness';
import { closeAndCheck, openTrade, tab, type Api, type UiCtx } from './w13-trade-ui-lib';

/** Live updates, keys, stall editor, balances, layouts and the final clean-up of the `/trade.html` UI steps. */

const NET_NOISE = /Failed to load resource|ERR_FAILED|ERR_INTERNET_DISCONNECTED|Failed to fetch|NetworkError/;

async function keyAction(page: Page, label: string, testid: string): Promise<void> {
  await page.getByTestId('key-row').filter({ hasText: label }).getByTestId(testid).click();
}

export function registerLiveSteps(ctx: UiCtx, api: Api): void {
  step0(ctx, api);
  step1(ctx, api);
  step2(ctx, api);
  step3(ctx, api);
  step4(ctx, api);
  step5(ctx, api);
}

function step0(ctx: UiCtx, api: Api): void {
  test('@hack 9m. /trade.html UI: the connection chip is LIVE; with the stream blocked it shows RECONNECTING and returns to LIVE, then an ask of another identity appears again', async ({ browser }) => {
    test.setTimeout(150_000);
    const b = await openTrade(browser, ctx, 'b', { track: false });
    const errs: string[] = [];
    b.on('pageerror', (e) => errs.push(e.message));
    b.on('console', (m) => { if (m.type() === 'error' && !NET_NOISE.test(m.text())) errs.push(m.text()); });
    try {
      const chip = b.getByTestId('trade-conn');
      await expect(chip).toHaveText('LIVE');
      // block new stream requests, then cut the open stream: the page must say so and retry
      await b.route('**/v1/trade/stream*', (r) => r.abort('failed'));
      await b.evaluate(() => { (window as unknown as { __trade: { stream: { ctl: AbortController } } }).__trade.stream.ctl.abort(); });
      await expect(chip).toHaveAttribute('data-conn', 'reconnecting', { timeout: 15_000 });
      await expect(chip).toContainText('RECONNECTING');
      await b.unroute('**/v1/trade/stream*');
      await expect(chip).toHaveAttribute('data-conn', 'live', { timeout: 60_000 });
      await expect(chip).toHaveText('LIVE');
      // the stream really delivers again: another identity's ask shows up without a reload
      const sell = await api.place('a', 'sell', 2, '4');
      expect([201, 202], JSON.stringify(sell.json)).toContain(sell.status);
      await expect(b.getByTestId('ladder-ask')).toHaveCount(1, { timeout: 30_000 });
      await api.clean();
      await expect(b.getByTestId('ladder-ask')).toHaveCount(0, { timeout: 30_000 });
      expect(errs).toEqual([]);
    } finally {
      await b.context().close();
    }
  });
}

function step1(ctx: UiCtx, api: Api): void {
  test('@hack 9n. /trade.html UI: keys panel: create with an allowance, the secret is shown once and copies, the usage meter follows an order, kill switch, two-step revoke', async ({ browser }) => {
    test.setTimeout(240_000);
    const label = `ui key ${Date.now() % 100_000}`;
    const a = await openTrade(browser, ctx, 'a', { clipboard: true });
    try {
      await tab(a, 'keys');
      await a.locator('#key-label').fill(label);
      await a.locator('#key-open').fill('2');
      await a.locator('#key-notional').fill('5');
      await a.locator('#key-daily').fill('20');
      await a.getByTestId('key-create').click();
      const secretEl = a.getByTestId('key-secret');
      await expect(secretEl).toBeVisible({ timeout: 30_000 });
      const secret = (await secretEl.textContent()) ?? '';
      expect(secret).toMatch(/^ta_bot_\S+/);
      await a.getByTestId('key-copy').click();
      await expect(a.getByTestId('key-copy')).toHaveText('COPIED');
      expect(await a.evaluate(() => navigator.clipboard.readText())).toBe(secret);
      const row = a.getByTestId('key-row').filter({ hasText: label });
      await expect(row).toContainText('ACTIVE');
      await expect(row).toContainText(/max 2 open/);
      await expect(row).toContainText(/order <= 5\.00/);
      await expect(row).toContainText(/day <= 20\.00/);
      // the secret is shown once: dismissing it, and a reload, never bring it back
      await a.getByTestId('key-saved').click();
      await expect(a.getByTestId('key-secret')).toHaveCount(0);
      await a.reload();
      await tab(a, 'keys');
      await expect(a.getByTestId('key-row').filter({ hasText: label })).toBeVisible({ timeout: 30_000 });
      expect(await a.locator('body').innerText()).not.toContain(secret);
      // an order of the key moves the usage meter (no reload)
      const usage = a.getByTestId('key-row').filter({ hasText: label }).getByTestId('key-usage');
      await expect(usage).toContainText('0 open orders');
      const o = await api.call('POST', '/orders', { key: secret, body: { side: 'sell', resource: ctx.water, amount: 3, price: { token: 'USDC', amount: ctx.usdc('3') }, ttlS: 3600 } });
      expect([201, 202], JSON.stringify(o.json)).toContain(o.status);
      await expect(usage).toContainText('1 open order', { timeout: 30_000 });
      await expect(usage.getByRole('meter')).not.toHaveAttribute('aria-valuenow', '0');
      // kill switch: the key cannot trade; release restores it
      await keyAction(a, label, 'key-kill');
      await expect(row).toContainText('KILL SWITCH ON', { timeout: 20_000 });
      const blocked = await api.call('POST', '/orders', { key: secret, body: { side: 'sell', resource: ctx.water, amount: 1, price: { token: 'USDC', amount: ctx.usdc('1') }, ttlS: 3600 } });
      expect(blocked.json.error?.code).toBe('kill_switch');
      await keyAction(a, label, 'key-kill');
      await expect(row).toContainText('ACTIVE', { timeout: 20_000 });
      // revoke takes two clicks; the first only asks to confirm and the key still works
      await keyAction(a, label, 'key-revoke');
      await expect(row.getByTestId('key-revoke-confirm')).toBeVisible();
      expect((await api.call('GET', '/balances', { key: secret })).status).toBe(200);
      await keyAction(a, label, 'key-revoke-confirm');
      await expect(row).toContainText('REVOKED', { timeout: 20_000 });
      await expect.poll(async () => (await api.call('GET', '/balances', { key: secret })).status, { timeout: 15_000 }).toBe(401);
    } finally {
      await closeAndCheck(a);
    }
  });
}

function step2(ctx: UiCtx, api: Api): void {
  test('@hack 9o. /trade.html UI: stall editor: out-of-range and malformed fees are refused with a message, 0.5 % is set, and it goes back to 1 %', async ({ browser }) => {
    test.setTimeout(120_000);
    const a = await openTrade(browser, ctx, 'a');
    try {
      const stallBp = async (): Promise<number> => (await api.call('GET', `/stall?planetId=${ctx.planetId()}`, { as: 'a' })).json.hubFeeBp;
      const pct = a.getByTestId('stall-pct');
      const msg = a.getByTestId('stall-msg');
      await expect(a.getByTestId('stall-current')).toHaveText('1.00 %');
      await expect(a.getByTestId('stall-earned')).toContainText(/mock USDC/);
      await pct.fill('150');
      await a.getByTestId('stall-apply').click();
      await expect(msg).toContainText(/outside the allowed range/);
      await pct.fill('abc');
      await a.getByTestId('stall-apply').click();
      await expect(msg).toContainText(/percentage/);
      expect(await stallBp(), 'refused values change nothing').toBe(100);
      await pct.fill('0.5');
      await a.getByTestId('stall-apply').click();
      await expect(msg).toContainText('Stall fee set to 0.50 %');
      await expect(a.getByTestId('stall-current')).toHaveText('0.50 %');
      await expect.poll(stallBp, { timeout: 20_000, message: 'GET /stall shows the new fee' }).toBe(50);
      await pct.fill('1');
      await a.getByTestId('stall-apply').click();
      await expect(msg).toContainText('Stall fee set to 1.00 %');
      await expect(a.getByTestId('stall-current')).toHaveText('1.00 %');
      await expect.poll(stallBp, { timeout: 20_000, message: 'GET /stall shows the 1 % fee' }).toBe(100);
    } finally {
      await closeAndCheck(a);
    }
  });
}

function step3(ctx: UiCtx, api: Api): void {
  test('@hack 9p. /trade.html UI: balances show only the caller\'s own cargo (B never sees A\'s water quantity)', async ({ browser }) => {
    test.setTimeout(120_000);
    const balA = await api.balances('a');
    const balB = await api.balances('b');
    expect(balA.waterTotal, 'A and B hold different water totals').not.toBe(balB.waterTotal);
    const a = await openTrade(browser, ctx, 'a');
    const b = await openTrade(browser, ctx, 'b');
    try {
      const waterTotal = async (p: Page): Promise<string | null> => {
        const row = p.locator('[data-panel-body=balances] tr').filter({ hasText: ctx.water });
        return (await row.count()) ? row.locator('td').nth(3).innerText() : null;
      };
      expect(await waterTotal(a)).toBe(balA.waterTotal.toString());
      expect(await waterTotal(b)).toBe(balB.waterTotal === 0n ? null : balB.waterTotal.toString());
      const bodyB = (await b.locator('[data-panel-body=balances]').innerText()).replace(/\s+/g, ' ');
      expect(bodyB).toMatch(/mock USDC/i);
      expect(bodyB).not.toMatch(new RegExp(`${ctx.water}\\s+(?:\\d+\\s+){0,2}${balA.waterTotal}\\b`));
      await expect(b.locator('[data-panel-body=balances]')).toContainText('Your colony on');
    } finally {
      await closeAndCheck(a);
      await closeAndCheck(b);
    }
  });
}

function step4(ctx: UiCtx, api: Api): void {
  test('@hack 9q. /trade.html UI: at 390 px and 1024 px there is no horizontal page scroll and the key columns are present', async ({ browser }) => {
    test.setTimeout(150_000);
    const sell = await api.place('a', 'sell', 3, '6');
    expect([201, 202], JSON.stringify(sell.json)).toContain(sell.status);
    for (const [width, height] of [[390, 844], [1024, 768]] as const) {
      const p = await openTrade(browser, ctx, 'a', { width, height });
      try {
        const noScroll = (): Promise<boolean> => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
        expect(await noScroll(), `${width}px main`).toBe(true);
        for (const id of ['trade-conn', 'ticket-place', 'ticket-amount', 'ticket-total']) await expect(p.getByTestId(id)).toBeVisible();
        await expect(p.locator('#pk-planet')).toBeVisible();
        await expect(p.getByTestId('ladder-ask')).toHaveCount(1, { timeout: 20_000 });
        await expect(p.getByTestId('tab-orders')).toBeVisible();
        await tab(p, 'market');
        await expect(p.getByTestId('book-order')).toHaveCount(1, { timeout: 20_000 });
        await tab(p, 'orders');
        const order = p.getByTestId('my-order');
        await expect(order).toHaveCount(1, { timeout: 20_000 });
        for (const col of ['TOTAL', 'RESERVED', 'FEES PLAT + STALL', 'TTL LEFT']) {
          if (width >= 1000) await expect(p.locator('[data-panel-body=orders] thead th', { hasText: col })).toBeVisible();
          else await expect(order.locator(`td[data-label="${col}"]`)).toBeVisible();
        }
        await expect(p.getByTestId('my-order-cancel')).toBeVisible();
        expect(await noScroll(), `${width}px with the orders table`).toBe(true);
        await tab(p, 'keys');
        expect(await noScroll(), `${width}px with the keys panel`).toBe(true);
        await p.screenshot({ path: test.info().outputPath(`trade-${width}.png`) });
      } finally {
        await closeAndCheck(p);
      }
    }
  });
}

function step5(ctx: UiCtx, api: Api): void {
  test('@hack 9r. /trade.html UI: clean-up leaves empty books and A\'s stall fee at 1 %', async () => {
    test.setTimeout(90_000);
    await api.clean();
    const stall = (await api.call('GET', `/stall?planetId=${ctx.planetId()}`, { as: 'a' })).json;
    if (stall.hubFeeBp !== 100) expect((await api.call('PUT', '/stall', { as: 'a', body: { planetId: ctx.planetId(), bp: 100 } })).status).toBe(200);
    expect(await api.bookCount()).toBe(0);
  });
}
