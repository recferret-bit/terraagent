import { expect } from 'vitest';
import type { MarketTokenKey } from '@terra/contracts';
import type { Exchange } from './exchange-harness.js';

const OPEN = ['OPEN', 'PARTIAL'];
const TERMINAL = ['FILLED', 'CANCELLED', 'EXPIRED', 'REJECTED'];
const dec = (x: { toFixed(): string }): bigint => BigInt(x.toFixed());

export interface AuditOptions {
  /** Trades allowed to be unfinished (held / unknown) at the time of the audit. */
  readonly inFlight?: boolean;
}

/** Sums of one planet's trades by state. */
export async function tradeSums(ex: Exchange, planetId: string) {
  const rows = await ex.tradesOf(planetId);
  const live = rows.filter((t) => t.state !== 'FAILED');
  return {
    rows,
    amount: live.reduce((s, t) => s + dec(t.amount), 0n),
    notional: live.reduce((s, t) => s + dec(t.notional), 0n),
    platformFee: live.reduce((s, t) => s + dec(t.platformFee), 0n),
    stallFee: live.reduce((s, t) => s + dec(t.stallFee), 0n),
  };
}

/**
 * Whole-planet consistency after any scenario: order rows, reservations, book and trades agree and nothing is released twice.
 *  - terminal orders hold no reservation; `filled <= amount`; a FILLED order is complete;
 *  - the in-memory book holds exactly the OPEN/PARTIAL rows, with their filled amounts;
 *  - both sides of every pair filled the same quantity and cumulative notional as the non-failed trades;
 *  - open reservations (+ in-flight trade debits) never exceed what the account holds at the verifier;
 *  - every order got at most one terminal `market.release` towards the sim, and no trade settled twice.
 */
export async function auditPlanet(ex: Exchange, planetId: string, o: AuditOptions = {}): Promise<void> {
  const orders = await ex.ordersOf(planetId);
  const open = orders.filter((r) => OPEN.includes(r.state));
  for (const r of orders) {
    const [amount, filled] = [dec(r.amount), dec(r.filled)];
    expect(filled <= amount, `filled>amount ${r.orderId}`).toBe(true);
    if (r.state === 'FILLED') expect(filled).toBe(amount);
    if (TERMINAL.includes(r.state)) {
      expect(dec(r.reservedPrincipal), `${r.orderId} ${r.state} principal`).toBe(0n);
      expect(dec(r.reservedFees), `${r.orderId} ${r.state} fees`).toBe(0n);
    } else if (OPEN.includes(r.state)) {
      expect(dec(r.reservedPrincipal) > 0n, `${r.orderId} open order without reservation`).toBe(true);
    }
  }
  for (const pair of new Set(orders.map((r) => r.pair))) {
    const book = await ex.books.book(planetId, pair);
    const ids = [...book.orders('buy'), ...book.orders('sell')].map((b) => b.orderId).sort();
    expect(ids, `book ${pair} ids`).toEqual(open.filter((r) => r.pair === pair).map((r) => r.orderId).sort());
    for (const b of [...book.orders('buy'), ...book.orders('sell')]) expect(b.filled).toBe(dec(orders.find((r) => r.orderId === b.orderId)!.filled));
  }
  const t = await tradeSums(ex, planetId);
  const side = (s: string, f: (r: (typeof orders)[number]) => bigint) => orders.filter((r) => r.side === s).reduce((a, r) => a + f(r), 0n);
  expect(side('buy', (r) => dec(r.filled)), 'buy-side filled == trades').toBe(t.amount);
  expect(side('sell', (r) => dec(r.filled)), 'sell-side filled == trades').toBe(t.amount);
  expect(side('buy', (r) => dec(r.cumNotional)), 'buy cumNotional == trades').toBe(t.notional);
  expect(side('sell', (r) => dec(r.cumNotional)), 'sell cumNotional == trades').toBe(t.notional);
  if (!o.inFlight) for (const tr of t.rows) expect(['FINAL', 'FAILED'], `trade ${tr.tradeId} ${tr.state}`).toContain(tr.state);

  const need = new Map<string, bigint>();
  for (const r of open) {
    const token = (r.side === 'sell' ? r.base : r.quote) as MarketTokenKey;
    const k = `${r.accountId}|${token}`;
    need.set(k, (need.get(k) ?? 0n) + dec(r.reservedPrincipal) + dec(r.reservedFees));
  }
  for (const [k, reserved] of need) {
    const [account, token] = k.split('|') as [string, MarketTokenKey];
    const view = await ex.funds.view(account, '', token);
    const held = (await ex.balOf(account, token)) + view.cargo;
    expect(reserved + (await ex.funds.inFlightDebit(account, token)) <= held, `reserved ${reserved} > held ${held} for ${k}`).toBe(true);
  }
  const ids = new Set(orders.map((r) => r.orderId));
  for (const id of ids) {
    const terminal = ex.releasesOf(id).filter((c) => ['cancelled', 'expired'].includes((c.args as { reason: string }).reason));
    expect(terminal.length, `terminal releases of ${id}`).toBeLessThanOrEqual(1);
  }
  const settled = ex.cmds.filter((c) => c.kind === 'market.settled' && t.rows.some((r) => r.tradeId === (c.args as { tradeId: string }).tradeId));
  const keys = settled.map((c) => `${(c.args as { tradeId: string }).tradeId}|${c.colonyId}|${(c.args as { role: string }).role}`);
  expect(new Set(keys).size, 'market.settled sent twice').toBe(keys.length);
}

/**
 * The ledger effect of the FINAL trades of one planet against the balances before them: buyer pays notional + both fees, seller gets the
 * notional, platform gets the platform fee, the maker stall gets the stall fee (per account and token, bigint exact).
 */
export async function expectLedgerDelta(ex: Exchange, planetId: string, before: Map<string, bigint>, extra: Record<string, bigint> = {}): Promise<void> {
  const { MARKET_TOKENS, toChainUnits } = await import('@terra/contracts');
  const want = new Map<string, bigint>();
  const add = (acc: string, token: string, d: bigint) => want.set(`${acc}|${MARKET_TOKENS[token as MarketTokenKey].verifierId}`, (want.get(`${acc}|${MARKET_TOKENS[token as MarketTokenKey].verifierId}`) ?? 0n) + toChainUnits(token as MarketTokenKey, d));
  for (const t of (await ex.tradesOf(planetId)).filter((r) => r.state === 'FINAL')) {
    const [n, pf, sf] = [dec(t.notional), dec(t.platformFee), dec(t.stallFee)];
    add(t.buyerAccountId, t.quote, -(n + pf + sf));
    add(t.sellerAccountId, t.quote, n);
    add(t.platformAccountId, t.quote, pf);
    add(t.stallAccountId, t.quote, sf);
    add(t.buyerAccountId, t.base, dec(t.amount));
    add(t.sellerAccountId, t.base, -dec(t.amount));
  }
  const after = await ex.ledger();
  for (const k of new Set([...want.keys(), ...after.keys(), ...before.keys()])) {
    const delta = (after.get(k) ?? 0n) - (before.get(k) ?? 0n);
    expect(delta, `ledger delta ${k}`).toBe(want.get(k) ?? extra[k] ?? 0n);
  }
}
