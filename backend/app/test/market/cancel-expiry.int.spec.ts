import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { withTransaction } from '@terra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PlanetEventOf } from '../../src/bus/channels.js';
import { EventBus } from '../../src/bus/event-bus.js';
import { MarketBooks } from '../../src/market/book/market-books.js';
import { MarketOrderRepository, type CreateMarketOrderInput } from '../../src/market/book/market-order.repository.js';
import { CancelOrderHandler, OrderRelease } from '../../src/market/orders/cancel-order.service.js';
import { PlanetGameClock } from '../../src/market/orders/expiry-clock.js';
import { OrderExpirySweep } from '../../src/market/orders/expiry-sweep.js';
import { MarketSimGateway, type NearMarketCommandBusEvent } from '../../src/market/orders/market-sim-gateway.js';

let db: TestDatabase;
beforeAll(async () => { db = await createTestDatabase(); });
afterAll(async () => { await db?.drop(); });

function rig() {
  const bus = new EventBus();
  const cmds: NearMarketCommandBusEvent[] = [];
  bus.on('near.market.command', (c) => cmds.push(c), { module: 'test' });
  const repo = new MarketOrderRepository(db.prisma);
  const books = new MarketBooks(repo);
  const release = new OrderRelease(repo, books, new MarketSimGateway(bus), db.prisma);
  const env = { NODE_ENV: 'test', DATABASE_URL: 'x' } as never;
  const clock = new PlanetGameClock();
  const sweep = new OrderExpirySweep(release, clock, db.prisma, env, { onWarp: () => () => undefined } as never);
  const handler = new CancelOrderHandler(bus, release, new MarketSimGateway(bus), env);
  return { repo, books, release, clock, sweep, handler, cmds };
}

let n = 0;
async function open(repo: MarketOrderRepository, over: Partial<CreateMarketOrderInput> = {}, planetId = 'p1') {
  n += 1;
  const id = `ord-${n}`;
  const { order } = await repo.createFromRequest({
    orderId: id, ref: `ref-${id}`, planetId, pair: 'bio.water/USDC', base: 'bio.water', quote: 'USDC', side: 'sell', colonyId: `col-${n}`, colonyIndex: 0,
    accountId: `acc-${n}`, stallColonyId: `col-${n}`, stallAccountId: `acc-${n}`, platformAccountId: 'platform', amount: 300n, priceAmount: 10n,
    fillPolicy: 'partial', policyVersion: 'v1', policyHash: 'h', platformFeeBp: 100, stallFeeBp: 100, ttlS: 900,
    expiresAt: new Date(Date.now() + 900_000), reservedPrincipal: 300n, reservedFees: 0n, state: 'OPEN', ...over,
  });
  return order;
}
const cancelEvent = (colonyId: string, orderId: string): PlanetEventOf<'marketCancelRequested'> =>
  ({ planetId: 'p1', tick: 1, kind: 'marketCancelRequested', severity: 'info', colonyIds: [colonyId], data: { colonyId, colonyIndex: 0, orderId } }) as never;

describe('cancel (W13-15)', () => {
  it('cancels an open order: CANCELLED, reservations 0, book synced, sim released once', async () => {
    const r = rig();
    const o = await open(r.repo);
    const book = await r.books.book('p1', o.pair);
    expect(book.size).toBe(1);
    const out = await r.handler.handle(cancelEvent(o.colonyId, o.orderId));
    expect(out?.kind).toBe('released');
    const row = (await r.repo.find(o.orderId))!;
    expect([row.state, row.reservedPrincipal, row.reservedFees]).toEqual(['CANCELLED', 0n, 0n]);
    expect(book.size).toBe(0);
    expect(r.cmds).toHaveLength(1);
    expect(r.cmds[0]).toMatchObject({ kind: 'market.release', args: { ref: o.ref, orderId: o.orderId, reason: 'cancelled', deltas: { 'bio.water': 300 } } });
    // double cancel: nothing released again
    expect((await r.handler.handle(cancelEvent(o.colonyId, o.orderId)))?.kind).toBe('noop');
    expect(r.cmds).toHaveLength(1);
  });

  it('only the owner cancels; unknown orders get an unknown_order reject for the sim', async () => {
    const r = rig();
    const o = await open(r.repo);
    expect((await r.handler.handle(cancelEvent('someone-else', o.orderId)))?.kind).toBe('foreign');
    expect((await r.repo.find(o.orderId))!.state).toBe('OPEN');
    expect(r.cmds.at(-1)).toMatchObject({ args: { reason: 'rejected', code: 'unknown_order' } });
    await r.handler.handle(cancelEvent('c', 'nope'));
    expect(r.cmds.at(-1)).toMatchObject({ args: { reason: 'rejected', code: 'unknown_order', ref: 'nope' } });
    expect((await r.release.release(o.ref, 'cancelled', o.colonyId)).kind).toBe('released'); // by ref too
  });

  it('concurrent cancels, expiry and a fill: reservations are released exactly once and never negative', async () => {
    for (let i = 0; i < 8; i++) {
      const r = rig();
      const o = await open(r.repo);
      const fill = withTransaction(db.prisma, async (tx) => {
        const [locked] = await r.repo.lockForUpdate([o.orderId], tx);
        if (!locked || (locked.state !== 'OPEN' && locked.state !== 'PARTIAL')) return false;
        await r.repo.updateFill(o.orderId, { filled: 100n, cumNotional: 3n, feeBuckets: {}, state: 'PARTIAL' }, tx);
        await r.repo.updateReservation(o.orderId, { reservedPrincipal: locked.reservedPrincipal - 100n, reservedFees: 0n }, tx);
        return true;
      });
      const outs = await Promise.all([r.release.release(o.orderId, 'cancelled', o.colonyId), r.release.release(o.orderId, 'cancelled', o.colonyId), r.release.release(o.orderId, 'expired'), fill]);
      expect(outs.slice(0, 3).filter((x) => typeof x !== 'boolean' && x.kind === 'released')).toHaveLength(1);
      expect(r.cmds.filter((c) => c.kind === 'market.release')).toHaveLength(1);
      const row = (await r.repo.find(o.orderId))!;
      expect(['CANCELLED', 'EXPIRED']).toContain(row.state);
      expect(row.reservedPrincipal).toBe(0n);
      const released = (r.cmds[0]!.args as { deltas: Record<string, number> }).deltas['bio.water']!;
      expect(BigInt(released) + row.filled).toBe(300n); // released + filled == reserved
    }
  });
});

describe('expiry sweep (W13-15)', () => {
  it('expires orders past their wall-clock TTL and leaves the rest', async () => {
    const r = rig();
    const old = await open(r.repo, { expiresAt: new Date(Date.now() - 1000) });
    const fresh = await open(r.repo);
    expect(await r.sweep.sweep()).toEqual([old.orderId]);
    expect((await r.repo.find(old.orderId))!.state).toBe('EXPIRED');
    expect((await r.repo.find(fresh.orderId))!.state).toBe('OPEN');
    expect(r.cmds[0]).toMatchObject({ args: { reason: 'expired', orderId: old.orderId } });
    expect(await r.sweep.sweep()).toEqual([]);
  });

  it('a 15-minute order disappears under warp x100 within one sweep (planet game time)', async () => {
    const r = rig();
    const o = await open(r.repo, {}, 'warped');
    const t0 = o.createdAt.getTime();
    const other = await open(r.repo, {}, 'unwarped');
    expect(await r.sweep.sweep(t0 + 1000)).toEqual([]);
    r.clock.record('warped', 100, t0 + 1000);
    expect(await r.sweep.sweep(t0 + 1000 + 8_000)).toEqual([]); // 8 s x100 = 800 s < 900 s
    expect(await r.sweep.sweep(t0 + 1000 + 10_000)).toEqual([o.orderId]); // 10 s x100 = 1000 s
    expect((await r.repo.find(o.orderId))!.state).toBe('EXPIRED');
    expect((await r.repo.find(other.orderId))!.state).toBe('OPEN');
  });

  it('game clock integrates a changing warp', () => {
    const c = new PlanetGameClock();
    c.record('p', 10, 1000);
    c.record('p', 1, 2000);
    expect(c.gameMsBetween('p', 0, 3000)).toBe(1000 + 10_000 + 1000);
    expect(c.gameMsBetween('q', 0, 3000)).toBe(3000);
  });
});
