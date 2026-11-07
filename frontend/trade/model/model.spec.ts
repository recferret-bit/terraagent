import { describe, expect, it } from 'vitest';
import type { BookLevel, MarketPolicyView, TradeFillView, TradeOrderView } from '@terra/contracts';
import { buildMarketLines } from './allOrders';
import { buildChart } from './chart';
import { buildLadder, spreadRatio } from './ladder';
import { previewTicket, type TicketInput } from './preview';
import { backoffDelay, createSseParser } from './sse';
import { applyBookPush, applyFill, applyOrder, applyStreamEvent, cancellable, filterOrders, freeOf, initialState } from './state';
import { cmpRatio, fmtAmount, parseUnits, timeLeft, totalAtLevel, tryParse } from './units';

const lvl = (num: string, den: number, amount: number, orders = 1): BookLevel => ({ num, den, amount, orders });

describe('units', () => {
  it('parses whole units and display amounts strictly', () => {
    expect(parseUnits('300')).toBe(300);
    expect(parseUnits('0')).toBeNull();
    expect(parseUnits('1.5')).toBeNull();
    expect(parseUnits('2000000000')).toBeNull();
    expect(tryParse('USDC', '10')).toBe(10_000_000n);
    expect(tryParse('USDC', '0.000001')).toBe(1n);
    expect(tryParse('USDC', '0')).toBeNull();
    expect(tryParse('USDC', '1e3')).toBeNull();
  });
  it('labels every amount as mock', () => { expect(fmtAmount('USDC', '10200000')).toBe('10.20 mock USDC'); });
  it('compares prices by cross multiplication without floats', () => {
    expect(cmpRatio({ num: '10000000', den: 300 }, { num: '33333', den: 1 })).toBe(1);
    expect(cmpRatio({ num: '2', den: 4 }, { num: '1', den: 2 })).toBe(0);
  });
  it('rounds a level to a total: up for a crossing buy, down for a crossing sell', () => {
    const third = { num: '10000000', den: 300 }; // 33333.33.. per unit
    expect(totalAtLevel(third, 300, 'up')).toBe(10_000_000n);
    expect(totalAtLevel(third, 100, 'up')).toBe(3_333_334n);
    expect(totalAtLevel(third, 100, 'down')).toBe(3_333_333n);
  });
  it('formats time left', () => {
    expect(timeLeft(10_000, 10_000)).toBe('expired');
    expect(timeLeft(75_000, 0)).toBe('1m 15s');
    expect(timeLeft(3_720_000, 0)).toBe('1h 02m');
  });
});

describe('ladder', () => {
  it('accumulates from the best price outwards and measures the spread', () => {
    const l = buildLadder([lvl('3000000', 100, 100), lvl('2000000', 100, 50)], [lvl('5000000', 100, 10), lvl('4000000', 100, 20), lvl('6000000', 100, 70)]);
    expect(l.bids.map((r) => r.cumulative)).toEqual([100, 150]);
    expect(l.asks.map((r) => r.cumulative)).toEqual([20, 30, 100]);
    expect(l.asks[0]!.price.num).toBe('4000000');
    expect(l.bestBid?.num).toBe('3000000');
    expect(l.spread).toEqual({ num: 100_000_000n, den: 10_000n });
    expect(spreadRatio(l.spread!)).toEqual({ num: '100000000', den: 10000 });
    expect(l.spreadBp).toBe(2857); // (40-30)/35 = 28.57 %
    expect(l.crossed).toBe(false);
    expect(Math.max(...l.asks.map((r) => r.depth), ...l.bids.map((r) => r.depth))).toBe(1);
  });
  it('handles empty sides and flags a crossed book', () => {
    const e = buildLadder([], []);
    expect(e.spread).toBeNull();
    expect(e.bestAsk).toBeNull();
    expect(buildLadder([lvl('9', 1, 1)], [lvl('5', 1, 1)]).crossed).toBe(true);
  });
});

const policy: MarketPolicyView = { policyVersion: 'p1', policyHash: 'h', platformFeeBp: 100, stallFeeMaxBp: 100, stallFeeDefaultBp: 100, ttlOptionsS: [3600], openOrderLimit: 20, minNotional: { USDC: '100000' } };
const ticket = (o: Partial<TicketInput>): TicketInput => ({
  side: 'buy', base: 'bio.water', quote: 'USDC', amountText: '300', totalText: '10', stallBp: 100, policy,
  freeQuote: 20_000_000n, freeUnits: 600n, hasColony: true, busy: false, ...o,
});

describe('order preview', () => {
  it('prices a buy like the host reserves it: 10 + 0.10 + 0.10 = 10.20', () => {
    const p = previewTicket(ticket({}));
    expect(p.blocked).toBeNull();
    expect([p.total, p.platformFee, p.stallFee, p.maxSpend]).toEqual([10_000_000n, 100_000n, 100_000n, 10_200_000n]);
  });
  it('says exactly why it is blocked', () => {
    expect(previewTicket(ticket({ hasColony: false })).blocked).toMatch(/No colony/);
    expect(previewTicket(ticket({ policy: null })).blocked).toMatch(/policy/);
    expect(previewTicket(ticket({ amountText: '0' })).blocked).toMatch(/whole amount/);
    expect(previewTicket(ticket({ totalText: 'abc' })).blocked).toMatch(/TOTAL price/);
    expect(previewTicket(ticket({ totalText: '0.05' })).blocked).toBe('Below the minimum notional 0.10 mock USDC.');
    expect(previewTicket(ticket({ freeQuote: 10_100_000n })).blocked).toBe('Not enough free mock USDC: need 10.20, free 10.10.');
    expect(previewTicket(ticket({ busy: true })).blocked).toMatch(/Sending/);
  });
  it('checks free in-orbit units for a sell and charges the seller nothing', () => {
    const ok = previewTicket(ticket({ side: 'sell' }));
    expect(ok.blocked).toBeNull();
    expect([ok.youReceive, ok.platformFee, ok.maxSpend]).toEqual([10_000_000n, 0n, 300n]);
    expect(previewTicket(ticket({ side: 'sell', freeUnits: 299n })).blocked).toMatch(/Not enough free bio.water in orbit: need 300, free 299/);
    expect(previewTicket(ticket({ side: 'sell', freeUnits: null })).blocked).toMatch(/unavailable/);
  });
});

const order = (id: string, o: Partial<TradeOrderView> = {}): TradeOrderView => ({
  orderId: id, ref: `r-${id}`, pair: 'bio.water/USDC', side: 'sell', resource: 'bio.water', amount: 100, filled: 0, price: { token: 'USDC', amount: '5000000' }, state: 'OPEN',
  fillPolicy: 'partial', policyVersion: 'p1', platformFeeBp: 100, stallFeeBp: 100, reserved: '100', expiresAtMs: 4_000_000, createdAtMs: 1000, planetId: 'pl', actorKind: 'player', lastError: null, ...o,
});
const fill = (tradeId: string, orderId: string, atMs = 1): TradeFillView => ({
  tradeId, orderId, pair: 'bio.water/USDC', base: 'bio.water', quote: 'USDC', amount: 100, notional: '3500000', platformFee: '35000', stallFee: '35000', stallFeeBp: 100,
  makerSide: 'sell', state: 'FINAL', atMs, side: 'sell', counterpartyKind: 'player',
});

describe('state reducers', () => {
  const s0 = initialState('pl', 'bio.water/USDC');
  it('upserts orders newest first and ignores another planet', () => {
    const s1 = applyOrder(applyOrder(s0, order('a')), order('b', { createdAtMs: 2000 }));
    expect(s1.orders.map((o) => o.orderId)).toEqual(['b', 'a']);
    const s2 = applyOrder(s1, order('a', { state: 'FILLED', filled: 100 }));
    expect(s2.orders.find((o) => o.orderId === 'a')?.state).toBe('FILLED');
    expect(applyOrder(s2, order('c', { planetId: 'other' })).orders).toHaveLength(2);
  });
  it('dedupes fills by trade and order', () => {
    const s1 = applyFill(applyFill(s0, fill('t1', 'a', 5)), fill('t1', 'a', 5));
    expect(s1.fills).toHaveLength(1);
    expect(applyFill(s1, fill('t1', 'b', 6)).fills.map((f) => f.orderId)).toEqual(['b', 'a']);
  });
  it('drops an older book push and keeps the top of every pair', () => {
    const push = (seq: number, pair = 'bio.water/USDC') => ({ planetId: 'pl', pair, bids: [lvl('1', 1, 1)], asks: [lvl('2', 1, seq)], seq });
    const s1 = applyBookPush(s0, push(5));
    expect(s1.book?.seq).toBe(5);
    expect(applyBookPush(s1, push(4)).book?.seq).toBe(5);
    const s2 = applyBookPush(s1, push(1, 'metals.t1/USDC'));
    expect(s2.book?.pair).toBe('bio.water/USDC');
    expect(s2.top['metals.t1/USDC']?.ask?.amount).toBe(1);
    expect(applyBookPush(s1, { ...push(9), planetId: 'elsewhere' })).toBe(s1);
  });
  it('routes stream events and goes live on hello', () => {
    expect(applyStreamEvent(s0, { type: 'hello', planetId: 'pl', serverTimeMs: 1 }).conn).toBe('live');
    expect(applyStreamEvent(s0, { type: 'fill', planetId: 'pl', fill: fill('t', 'o') }).fills).toHaveLength(1);
    expect(applyStreamEvent(s0, { type: 'fill', planetId: 'x', fill: fill('t', 'o') }).fills).toHaveLength(0);
  });
  it('filters orders by state and lists cancellable ones', () => {
    const list = [order('o1'), order('o2', { state: 'PARTIAL', filled: 10 }), order('o3', { state: 'FILLED', filled: 100 }), order('o4', { state: 'CANCELLED' }), order('o5', { state: 'EXPIRED' })];
    expect(filterOrders(list, 'open').map((o) => o.orderId)).toEqual(['o1', 'o2']);
    expect(filterOrders(list, 'filled').map((o) => o.orderId)).toEqual(['o3']);
    expect(filterOrders(list, 'cancelled')).toHaveLength(1);
    expect(filterOrders(list, 'expired')).toHaveLength(1);
    expect(cancellable(list).map((o) => o.orderId)).toEqual(['o1', 'o2']);
  });
  it('reads free balances of quote tokens and cargo', () => {
    const b = { planetId: 'pl', colonyId: 'c', quote: { USDC: { free: '5', reserved: '1', total: '6' } }, inOrbit: { 'bio.water': { free: '7', reserved: '0', total: '7' } } };
    expect(freeOf(b, 'USDC')).toBe(5n);
    expect(freeOf(b, 'bio.water')).toBe(7n);
    expect(freeOf(b, 'metals.t1')).toBe(0n);
    expect(freeOf(null, 'USDC')).toBeNull();
  });
});

describe('all orders table', () => {
  it('puts own orders under their level and keeps own orders beyond the fetched depth', () => {
    const asks = [lvl('5000000', 100, 100, 2), lvl('6000000', 100, 10)];
    const mine = order('mine'); // 5,000,000 / 100
    const far = order('far', { price: { token: 'USDC', amount: '9000000' } });
    const lines = buildMarketLines(asks, [lvl('3000000', 100, 5)], [mine, far, order('done', { state: 'FILLED' })], 'bio.water/USDC');
    expect(lines.map((l) => (l.kind === 'own' ? `own:${l.order.orderId}` : `${l.side}:${l.price.num}`))).toEqual(['sell:6000000', 'sell:5000000', 'own:mine', 'own:far', 'buy:3000000']);
    const level = lines.find((l) => l.kind === 'level' && l.price.num === '5000000');
    expect(level && level.kind === 'level' ? level.ownAtLevel : -1).toBe(1);
  });
});

describe('sse', () => {
  it('reassembles events split across chunks and drops heartbeats', () => {
    const p = createSseParser();
    expect(p.push('data: {"a"')).toEqual([]);
    expect(p.push(':1}\n\n: ping\n\ndata: {"b":2}\r\n\r\n')).toEqual(['{"a":1}', '{"b":2}']);
  });
  it('backs off exponentially, capped, with bounded jitter', () => {
    expect(backoffDelay(0, { jitter: 0 })).toBe(1000);
    expect(backoffDelay(3, { jitter: 0 })).toBe(8000);
    expect(backoffDelay(20, { jitter: 0 })).toBe(30_000);
    expect(backoffDelay(0, { jitter: 0.5 }, () => 1)).toBe(1500);
  });
});

describe('candle chart', () => {
  it('maps candles into the plot and volumes into the band', () => {
    expect(buildChart([])).toBeNull();
    const g = buildChart([{ t: 2, o: '30', h: '40', l: '20', c: '25', v: 5 }, { t: 1, o: '20', h: '30', l: '10', c: '30', v: 10 }])!;
    expect(g.candles.map((c) => c.up)).toEqual([true, false]); // sorted by time
    expect(g.lo).toBe(10);
    expect(g.hi).toBe(40);
    expect(g.candles[0]!.volH).toBe(36);
    expect(g.candles[0]!.yHigh).toBeLessThan(g.candles[0]!.yLow);
  });
});
