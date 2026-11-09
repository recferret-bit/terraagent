import type { MarketTokenKey } from '@terra/contracts';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { auditPlanet, expectLedgerDelta } from '../exchange/exchange-audit.js';
import { Exchange, mockChainControls, ord, type Actor } from '../exchange/exchange-harness.js';
import { expectSimMirror, grant, snapshotOf } from './real-checks.js';
import { realWorld } from './real-planet.js';

const SEEDS = [11, 202, 3033];
const STEPS = 300;
const BATCH = 10;
const TRADE = { port: 'Intents', method: 'execute', opIdPrefix: 'trade:' } as const;
const dec = (x: { toFixed(): string }): bigint => BigInt(x.toFixed());

/** mulberry32: a seeded PRNG, so a failing seed replays the same session. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let ex: Exchange;
beforeAll(async () => { ex = await Exchange.boot({ OUTBOX_MAX_ATTEMPTS: '3' }, { realSim: true }); });
afterEach(() => mockChainControls.reset());
afterAll(async () => { await ex?.close(); });

/** Relay, reconcile and re-match until no trade is in flight. */
async function quiesce(planetId: string): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await ex.settle();
    await ex.recovery.reconcile();
    await ex.settle();
    const open = (await ex.tradesOf(planetId)).filter((t) => ['PENDING', 'UNKNOWN', 'HELD'].includes(t.state));
    if (open.length === 0) return;
  }
  throw new Error('trades still in flight after 8 settle rounds');
}

/** Sorted book (price-time), books == DB, reservations == requirement, no negative free funds, every FINAL trade applied once. */
async function invariants(planetId: string, actors: readonly Actor[], before: Awaited<ReturnType<typeof snapshotOf>>, full: boolean): Promise<void> {
  const orders = await ex.ordersOf(planetId);
  for (const o of orders.filter((r) => ['OPEN', 'PARTIAL'].includes(r.state))) {
    const [amount, filled, price, rp, rf] = [dec(o.amount), dec(o.filled), dec(o.priceAmount), dec(o.reservedPrincipal), dec(o.reservedFees)];
    if (o.side === 'sell') {
      expect([rp, rf], `sell ${o.orderId} reservation`).toEqual([amount - filled, 0n]);
    } else {
      expect(rp <= price && rp + rf > 0n, `buy ${o.orderId} reservation ${rp}+${rf}`).toBe(true);
      if (o.state === 'OPEN') expect(rp, `open buy ${o.orderId} principal`).toBe(price);
    }
  }
  for (const pair of new Set(orders.map((r) => r.pair))) {
    const book = await ex.books.book(planetId, pair);
    for (const [side, sign] of [['buy', -1n], ['sell', 1n]] as const) {
      const list = book.orders(side);
      for (let i = 1; i < list.length; i++) {
        const [a, b] = [list[i - 1]!, list[i]!];
        const cmp = (a.priceAmount * b.amount - b.priceAmount * a.amount) * sign; // unit price compare by cross multiplication
        expect(cmp < 0n || (cmp === 0n && a.seq < b.seq), `${pair} ${side} book out of order at ${i}`).toBe(true);
      }
    }
  }
  for (const a of actors) {
    for (const token of ['USDC', 'bio.water'] as MarketTokenKey[]) {
      const v = await ex.funds.view(a.accountId, token);
      const raw = v.cargo + v.verifier - v.reserved - (await ex.funds.inFlightDebit(a.accountId, token));
      expect(raw >= 0n, `${a.name} ${token} negative free ${raw}`).toBe(true);
    }
  }
  for (const r of await ex.prisma.mockChainIntentsBalance.findMany()) expect(BigInt(r.amount.toFixed()) >= 0n, `negative verifier balance ${r.accountId} ${r.tokenId}`).toBe(true);
  for (const t of (await ex.tradesOf(planetId)).filter((x) => ['FINAL', 'FAILED'].includes(x.state))) {
    const n = await ex.prisma.mockChainReceipt.count({ where: { opId: `trade:${t.tradeId}`, status: 'success' } });
    expect(n, `trade ${t.tradeId} ${t.state} applied ${n} times`).toBe(t.state === 'FINAL' ? 1 : 0);
  }
  if (full) {
    expect(await ex.supply(), 'per-token conservation').toEqual(before.sup);
    await expectLedgerDelta(ex, planetId, before.led);
    await auditPlanet(ex, planetId);
  } else {
    await auditPlanet(ex, planetId, { inFlight: true });
  }
}

const ALLOWED = new Set([
  'max_open_orders', 'daily_budget_exceeded', 'max_order_notional', 'insufficient_funds', 'insufficient_cargo', 'order_limit', 'price_out_of_band', 'order_too_small', 'self_trade',
]);

async function session(seed: number): Promise<{ counts: Record<string, number>; trades: number }> {
  const rand = rng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const w = await realWorld(ex, 10);
  const rich = { USDC: '2000', 'bio.water': '400' } as const;
  const actors: Actor[] = [];
  for (let i = 0; i < 6; i++) actors.push(await w.bot({ idx: i, fund: rich }));
  for (let i = 6; i < 10; i++) {
    const p = await w.player({ idx: i });
    await grant(ex, p, 'USDC', 2000);
    await grant(ex, p, 'bio.water', 400);
    actors.push(p);
  }
  const before = await snapshotOf(ex);
  const ttls = ex.policy.current().ttlOptionsS;
  const log: string[] = [];
  const counts: Record<string, number> = { placed: 0, filled: 0, cancelled: 0, rejected: 0, faults: 0 };
  let step = 0;
  try {
    for (step = 1; step <= STEPS; step++) {
      const a = pick(actors);
      const dice = rand();
      if (dice < 0.06) {
        const kind = pick(['fail_before', 'fail_after', 'insufficient_funds'] as const);
        mockChainControls.faults.inject({ kind, ...TRADE, times: 1 });
        counts.faults!++;
        log.push(`${step} fault ${kind}`);
      } else if (dice < 0.30) {
        const open = await ex.prisma.marketOrder.findMany({ where: { planetId: w.planetId, colonyId: a.colonyId, state: { in: ['OPEN', 'PARTIAL'] } } });
        if (open.length > 0) {
          const o = pick(open);
          const r = await a.cancel(o.orderId);
          log.push(`${step} ${a.name} cancel ${o.orderId} -> ${r.status}`);
          expect(r.status, `cancel ${JSON.stringify(r.body)}`).toBeLessThan(500);
          if (r.status === 200) counts.cancelled!++;
        }
      } else {
        const side = rand() < 0.5 ? 'sell' : 'buy';
        const units = 1 + Math.floor(rand() * 25);
        const unit = rand() < 0.15 ? 60_000 + Math.floor(rand() * 100_000) : 90_000 + Math.floor(rand() * 7) * 5_000;
        const body = ord(side, units, BigInt(Math.max(100_000, units * unit)), { ttlS: pick(ttls) });
        const r = await a.place(body);
        log.push(`${step} ${a.name} ${side} ${units}@${unit} -> ${r.status} ${r.body?.error?.code ?? r.body?.order?.state ?? ''}`);
        expect(r.status, `place ${JSON.stringify(r.body)}`).toBeLessThan(500);
        if (r.status < 300) { counts.placed!++; if (r.body.order?.state === 'FILLED') counts.filled!++; } else {
          counts.rejected!++;
          expect(ALLOWED.has(r.body?.error?.code), `unexpected rejection ${JSON.stringify(r.body)}`).toBe(true);
        }
      }
      if (step % BATCH === 0) {
        const full = step % (BATCH * 5) === 0 || step === STEPS;
        if (full) { await quiesce(w.planetId); mockChainControls.reset(); }
        await invariants(w.planetId, actors, before, full);
      }
    }
    await quiesce(w.planetId);
    await invariants(w.planetId, actors, before, true);
    await expectSimMirror(ex, w.planetId, actors);
  } catch (e) {
    const tail = log.slice(-25).join('\n');
    throw new Error(`SOAK BREAK seed=${seed} step=${step}: ${(e as Error).message}\n--- last actions ---\n${tail}`, { cause: e });
  }
  return { counts, trades: (await ex.tradesOf(w.planetId)).filter((t) => t.state === 'FINAL').length };
}

describe('REAL sim soak: seeded random multi-actor session over REST', () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: ${STEPS} steps of 6 bots + 4 players, random orders, cancels and chain faults keep every invariant`, async () => {
      const r = await session(seed);
      console.log(`[soak ${seed}] ${JSON.stringify(r)}`);
      expect(r.trades).toBeGreaterThan(0);
    }, 900_000);
  }
});
