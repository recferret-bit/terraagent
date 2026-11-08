import type { Page } from '@playwright/test';
import { expect, loadScenario, test } from './harness';
import { BotApi, type Bot } from './w13-bots-api';
import type { TradeStepsCtx } from './w13-trade';

/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed JSON replies */
const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? a : gcd(b, a % b));

/** The three organic trades of the reference story (amount, total price in USDC). Unit prices 0.25 / 0.27 / 0.29: no outlier (50 % cap). */
const TRADES = [
  { seller: 0, buyer: 1, amount: 4, usdc: '1' },
  { seller: 2, buyer: 3, amount: 5, usdc: '1.35' },
  { seller: 1, buyer: 2, amount: 6, usdc: '1.74' },
] as const;

/**
 * W13 D-45 bot API on the four-colony scenario `w13m` (`tests/scenarios/w13-markets-multi.ts`): steps 9f-1b, 9f-7b, 9f-22b, the ones
 * that need an organic reference price (>= 3 trades, >= 10 units, >= 3 counterparties, none above 40 %). It loads its OWN planet
 * (a page with `?scenario=w13m`) in a separate serial describe, so the two-colony `w13` planet and its numbers stay untouched.
 * Parties: one dev bot per sim colony (`m0`..`m3` on col_0..col_3, four distinct owners); accounts are planet-scoped, so nothing
 * is shared with the human session of that planet except col_0.
 *
 * Staleness without waiting an hour: dev command `market.ageTrades {planetId, seconds}` moves the settle time of the planet's FINAL
 * trades into the past (`market/dev/market-seed.service.ts`). Documented behaviour found while building this: the board hides the
 * VWAP at `stalenessS` = 3600 s and the quote agent calls a reference stale at `referenceMaxAgeS` = 3600 s, so `stale_reference`
 * is visible only inside the 5 s board cache window; after it the quote says `no_reference` (see the 9f-22b annotation).
 */
interface Multi {
  ctx: TradeStepsCtx;
  api: BotApi;
  bots: Bot[];
  planetId: string;
  vwap: { num: bigint; den: bigint };
  eligible: number;
  board(): Promise<any>;
}

/** Registers 9f-1b, 9f-7b and 9f-22b (a serial describe with its own `w13m` planet; the lead calls this from `w13.spec.ts`). */
export function registerMultiColonySteps(ctx: TradeStepsCtx): void {
  test.describe('w13m four colonies', () => {
    test.describe.configure({ mode: 'serial' });
    let page: Page;
    const m = { ctx, bots: [], planetId: '', vwap: { num: 0n, den: 0n }, eligible: 0 } as unknown as Multi;
    test.beforeAll(async ({ browser }) => {
      test.setTimeout(300_000);
      page = await (await browser.newContext()).newPage();
      await seedPlanet(m, page);
    });
    test.afterAll(async () => { await page?.context().close().catch(() => undefined); });
    referenceStep(m);
    bandStep(m);
    quoteStep(m);
  });
}

async function seedPlanet(m: Multi, page: Page): Promise<void> {
  await loadScenario(page, 'w13m', { skip: '1' }, { as: 'm', timeout: 280_000 });
  m.planetId = await page.evaluate(() => (window as unknown as { __online: { planetId: string } }).__online.planetId);
  expect(m.planetId).toMatch(/^pl_/);
  m.api = new BotApi({ ...m.ctx, planetId: () => m.planetId });
  // same reason as w13.spec step 1: nightfall switches Solar off and the Trade Hubs with it
  expect((await m.api.dev('time', { planetId: m.planetId, timeOfDay: 12, timeScale: 0 })).status).toBe(200);
  m.board = async () => {
    const r = await m.api.call('GET', `/v1/trade/board/${m.planetId}`);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    return (r.json.board as any[]).find((x) => x.pair === m.api.pair);
  };
  const tag = Date.now().toString(36).slice(-4);
  const fund = { USDC: '300', [m.ctx.water]: '300', 'metals.t1': '100' };
  const allowance = { maxOpenOrders: 10, maxOrderNotional: m.ctx.usdc('100'), dailyBudget: m.ctx.usdc('1000') };
  for (let i = 0; i < 4; i++) m.bots.push(await m.api.bot(`m${i}${tag}`, i, { fund, allowance }));
  // Only the seated session (col_0) gets its in-orbit fixture mirrored into the sim; the other colonies have no session, so the
  // sim `cargo.inOrbit` of their fixture (the verifier part is the bot `fund` above) is granted here, the same `dev.cargoGrant` the
  // fixture service uses (a labelled fixture, same numbers as `W13M_FIXTURES`).
  for (let i = 1; i < 4; i++) {
    for (const resource of [m.ctx.water, 'metals.t1']) {
      const send = (): Promise<{ ok: boolean; code?: string }> => page.evaluate(([c, r]) => (window as unknown as { __online: { commands: { send(k: string, a: unknown): Promise<{ ok: boolean; code?: string }> } } }).__online.commands.send('dev.cargoGrant', { colonyIndex: c, resource: r, amount: 300 }), [i, resource] as const);
      let ack = await send();
      for (let retry = 0; !ack.ok && ack.code === 'timeout' && retry < 3; retry++) ack = await send(); // a loaded machine can miss the 5 s ack; the grant is applied at most once per ack, a re-grant only adds fixture water
      expect(ack.ok, `dev.cargoGrant col_${i} ${resource}: ${JSON.stringify(ack)}`).toBe(true);
    }
  }
}

function referenceStep(m: Multi): void {
  const { ctx } = m;
  test('@hack 9f-1b. Organic reference: 3 organic trades / 15 units / 4 counterparties (none above 40 %) flip the board from insufficient_data to organic with the exact VWAP', async () => {
    test.setTimeout(300_000);
    expect(new Set(m.bots.map((b) => b.ownerId)).size, 'four distinct owners').toBe(4);
    const tradeIds: string[] = [];
    for (const [n, t] of TRADES.entries()) {
      const x = await m.api.cross(m.bots[t.seller]!, m.bots[t.buyer]!, t.amount, t.usdc);
      const fb = await m.api.waitFill(m.bots[t.buyer]!, x.buy);
      const fa = await m.api.waitFill(m.bots[t.seller]!, x.sell);
      expect(fa.tradeId).toBe(fb.tradeId);
      expect([fa.organic, fb.organic], `trade ${n + 1} is organic`).toEqual([true, true]);
      tradeIds.push(fa.tradeId);
      if (n < 2) {
        await expect.poll(async () => (await m.board()).volume24h, { timeout: 20_000 }).toBe(TRADES.slice(0, n + 1).reduce((s, x) => s + x.amount, 0));
        const row = await m.board();
        expect(row.classification).toBe('insufficient_data');
        expect(row.vwap, `after ${n + 1} organic trade(s) there is no reference yet`).toBeNull();
      }
    }
    const atomic = (usdc: string): bigint => BigInt(ctx.usdc(usdc));
    const sumN = TRADES.reduce((s, t) => s + atomic(t.usdc), 0n);
    const sumA = BigInt(TRADES.reduce((s, t) => s + t.amount, 0));
    const g = gcd(sumN, sumA);
    m.vwap = { num: sumN / g, den: sumA / g };
    m.eligible = Number(sumA);
    await expect.poll(async () => (await m.board()).classification, { timeout: 30_000, message: 'board reaches organic' }).toBe('organic');
    const row = await m.board();
    expect(row.vwap, 'exact rational of the three trades').toEqual({ num: m.vwap.num.toString(), den: Number(m.vwap.den) });
    // independent cross-check: the public trade list carries the same exact notionals
    const listed = ((await m.api.market()).json.recentTrades as any[]).filter((t) => tradeIds.includes(t.tradeId));
    expect(listed.reduce((s, t) => s + BigInt(t.notional), 0n)).toBe(sumN);
    expect(listed.reduce((s, t) => s + BigInt(t.amount), 0n)).toBe(sumA);
    expect(row.eligibleVolume).toBe(15);
    expect(row.counterparties).toBe(4);
    // shares in bp of 2x volume: m0 4, m1 4+6, m2 5+6, m3 5 of 30 -> top = 11/30
    expect(row.concentrationBp).toBe(Number((11n * 10_000n) / 30n));
    expect(row.concentrationBp).toBeLessThanOrEqual(4000);
    expect(row.botShareBp, 'every trade has a bot on a side').toBe(10_000);
    expect(row.reason ?? null).toBeNull();
    expect(row.volume24h).toBe(15);
  });
}

function bandStep(m: Multi): void {
  const { ctx } = m;
  test('@hack 9f-7b. price_out_of_band: with a reference, an ask outside the key band is rejected with a stable code; inside (and at the exact edge) it rests', async () => {
    test.setTimeout(180_000);
    expect(m.vwap.den, 'needs the reference of 9f-1b').toBeGreaterThan(0n);
    const banded = await m.api.bot(`mb${Date.now().toString(36).slice(-4)}`, 3, { fund: { USDC: '50', [ctx.water]: '100' }, allowance: { priceBandBp: 1000, maxOpenOrders: 10, maxOrderNotional: ctx.usdc('100'), dailyBudget: ctx.usdc('1000') } });
    const code = (r: { json: any }): string | undefined => r.json.error?.code;
    // 5 units at the VWAP are 1.3633 USDC; the +-10 % edges are 1.2270 and 1.4997
    for (const usdc of ['5', '1.51', '1.22']) {
      const r = await m.api.place(banded, m.api.order('sell', 5, usdc), 'band');
      expect([r.status, code(r)], `${usdc} USDC for 5 units is outside +-10 %: ${JSON.stringify(r.json)}`).toEqual([422, 'price_out_of_band']);
    }
    for (const usdc of ['1.36', '1.49', '1.23']) {
      const r = await m.api.place(banded, m.api.order('sell', 5, usdc), 'band');
      expect(r.status, `${usdc} USDC for 5 units is inside the band: ${JSON.stringify(r.json)}`).toBe(201);
    }
    await m.api.cancelAll(banded);
  });
}

function quoteStep(m: Multi): void {
  const { ctx } = m;
  test('@hack 9f-22b. Agent quote after organic trades: real bid and ask, the returned bodies POST as they are; stale_reference once the last organic trade is older than the limit', async () => {
    test.setTimeout(240_000);
    expect(m.eligible).toBe(15);
    const bot = m.bots[3]!;
    const q = async (): Promise<any> => {
      const r = await m.api.trade('GET', `/agent/quote?resource=${ctx.water}&planned=50&localUnitCost=1000000&transportPerUnit=0&ownUnitCost=1&keep=0`, { key: bot.key });
      expect(r.status, JSON.stringify(r.json)).toBe(200);
      return r.json;
    };
    const fresh = await q();
    expect(fresh.basis).toBe('organic');
    expect(fresh.inputs.eligibleVolume).toBe(15);
    expect([fresh.bidReasons, fresh.askReasons], JSON.stringify(fresh)).toEqual([[], []]);
    expect(fresh.bid, 'bid quoted').toBeTruthy();
    expect(fresh.ask, 'ask quoted').toBeTruthy();
    // mid = VWAP at neutral scarcity; bid below, ask above it (200 bp half spreads), as exact unit prices
    const mid = { num: BigInt(fresh.mid.num), den: BigInt(fresh.mid.den) };
    expect(mid.num * m.vwap.den, 'neutral scarcity: mid equals the VWAP').toBe(m.vwap.num * mid.den);
    const unit = (s: any): bigint => (BigInt(s.order.price.amount) * mid.den * 1_000_000n) / (BigInt(s.order.amount) * mid.num);
    expect(unit(fresh.bid)).toBeLessThan(1_000_000n);
    expect(unit(fresh.ask)).toBeGreaterThan(1_000_000n);
    for (const side of [fresh.bid, fresh.ask]) {
      const r = await m.api.trade('POST', '/orders', { key: bot.key, body: side.order, idem: m.api.idem('q22b') });
      expect([201, 202], `quote body POSTs as is: ${JSON.stringify(r.json)}`).toContain(r.status);
    }
    await m.api.cancelAll(bot);

    // age the reference: the last organic trade is E seconds old; make it ~3598 s old when the board cache is rebuilt, then
    // poll the quote until its age passes 3600 s while that cached board still serves the VWAP
    const E = (await q()).inputs.referenceAgeS as number;
    const aged = await m.api.dev('market.ageTrades', { planetId: m.planetId, seconds: 3598 - E - 6 });
    expect(aged.status, JSON.stringify(aged.json)).toBe(200);
    await new Promise((r) => setTimeout(r, 5500)); // the pre-aging cache entry expires
    const refreshed = await m.board();
    expect(refreshed.vwap, 'still fresh (< 3600 s): the reference stands').not.toBeNull();
    let seen: any = null;
    const until = Date.now() + 8000;
    while (Date.now() < until) {
      seen = await q();
      if (seen.bidReasons.includes('stale_reference') || seen.bidReasons.includes('no_reference')) break;
      await new Promise((r) => setTimeout(r, 300));
    }
    test.info().annotations.push({ type: 'observed', description: `quote after aging: ${JSON.stringify({ ageS: seen.inputs.referenceAgeS, bid: seen.bid, bidReasons: seen.bidReasons, askReasons: seen.askReasons })}` });
    expect(seen.inputs.referenceAgeS).toBeGreaterThan(3600);
    expect(seen.bid, 'a stale reference never yields a bid').toBeNull();
    expect(seen.bidReasons, 'stale, not missing').toContain('stale_reference');
    // once the cache expires the board itself withholds the reference (the same 3600 s limit): reason stale
    await expect.poll(async () => (await m.board()).reason, { timeout: 15_000 }).toBe('stale');
    expect((await m.board()).vwap).toBeNull();
  });
}

