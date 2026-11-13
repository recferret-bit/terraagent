import 'reflect-metadata';
import { ACHIEVEMENT_FAMILY_IDS, toChainUnits } from '@terra/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootHarness, USDC, WATER, acct, type Harness } from '../../../backend/app/test/market/market-harness';
import type { PlanetEventOf } from '../../../backend/app/src/bus/channels.js';
import { EventBus } from '../../../backend/app/src/bus/event-bus.js';
import { FlagsService } from '../../../backend/app/src/flags/flags.service.js';
import { ProgressionEventForwarder } from '../../../backend/app/src/game/progression-events.service.js';
import { CancelOrderHandler } from '../../../backend/app/src/market/orders/cancel-order.service.js';
import { MarketProgressionProducer } from '../../../backend/app/src/market/progression/market-progression.producer.js';
import { FactsUpdaterService } from '../../../backend/app/src/progression/facts-updater.service.js';
import { FactsStore } from '../../../backend/app/src/progression/facts.store.js';
import type { FamilyAvailabilityService } from '../../../backend/app/src/progression/family-availability.js';
import { ProgressionEngine } from '../../../backend/app/src/progression/progression-engine.js';

/**
 * W13-49 acceptance (4)+(5) on Postgres and the mock chain: per-token zero-sum for every FINAL trade batch, a closed verifier
 * ledger, reservations released exactly once, and the Merchant / Port Authority facts a real FINAL trade produces.
 */
let h: Harness;
beforeAll(async () => { h = await bootHarness(); await h.intents.testRegisterSigner('protocol.terraagent.mock'); }, 120_000);
afterAll(async () => { await h?.close(); });

type Leg = { accountId: string; token: string; delta: string | number };
const totals = async (): Promise<Record<string, bigint>> => {
  const out: Record<string, bigint> = {};
  for (const b of await h.db.prisma.mockChainIntentsBalance.findMany()) out[b.tokenId] = (out[b.tokenId] ?? 0n) + BigInt(b.amount.toFixed());
  return out;
};

describe('every FINAL trade batch conserves each token', () => {
  it('legs sum to zero per token, the verifier ledger totals do not change, orders end with nothing reserved', async () => {
    const t = await h.matched(1);
    const before = await totals();
    expect(await h.relay.pollOnce()).toBeGreaterThan(0);
    const trade = (await h.trades.find(t.tradeId))!;
    expect(trade.state).toBe('FINAL');
    const perToken = new Map<string, bigint>();
    for (const l of trade.legs as unknown as Leg[]) perToken.set(l.token, (perToken.get(l.token) ?? 0n) + BigInt(l.delta));
    expect(perToken.size).toBeGreaterThanOrEqual(2); // base and quote
    for (const [token, sum] of perToken) expect(sum, token).toBe(0n);
    expect(await totals()).toEqual(before); // nothing minted or burnt by settlement
    for (const id of [t.askId, t.bidId]) {
      const o = await h.order$(id);
      expect([o.state, o.reservedPrincipal.toFixed(), o.reservedFees.toFixed()]).toEqual(['FILLED', '0', '0']);
    }
    // the buyer paid notional + platform + stall fee in quote; the seller got the full base amount delivered
    expect(BigInt(await h.verifier(acct(t.buyer), USDC))).toBe(10_000_000n - 5_100_000n);
    expect(await h.verifier(acct(t.buyer), WATER)).toBe(toChainUnits('bio.water', 300n).toString());
  });

  it('a cancelled resting buy releases its reservation exactly once; a second cancel changes nothing', async () => {
    await h.colony('b9', { usdc: 10_000_000n });
    const placed = (await h.place.handle(h.order('pr9', 'b9', { side: 'buy', price: { token: 'USDC', amount: '5000000' }, maxStallFeeBp: 100 })))!;
    const open = await h.order$(placed.order.orderId);
    expect(open.state).toBe('OPEN');
    expect(open.reservedPrincipal.toFixed()).toBe('5000000');
    expect(open.reservedFees.toFixed()).toBe('100000'); // platform 1 % + max stall 1 % of 5.00 USDC
    const cancel = h.app.get(CancelOrderHandler);
    const ev = { planetId: 'pr9', tick: 1, kind: 'marketCancelRequested', severity: 'info', colonyIds: ['b9'], data: { colonyId: 'b9', colonyIndex: 1, orderId: open.orderId } } as unknown as PlanetEventOf<'marketCancelRequested'>;
    expect((await cancel.handle(ev))?.kind).toBe('released');
    const done = await h.order$(open.orderId);
    expect([done.state, done.reservedPrincipal.toFixed(), done.reservedFees.toFixed()]).toEqual(['CANCELLED', '0', '0']);
    const usdcAfter = await h.verifier(acct('b9'), USDC);
    expect((await cancel.handle(ev))?.kind).toBe('noop');
    expect(await h.verifier(acct('b9'), USDC)).toBe(usdcAfter);
    expect(usdcAfter).toBe('10000000'); // the whole balance is free again
  });

  it('an insufficient inclusive balance is refused and nothing stays reserved', async () => {
    await h.colony('b8', { usdc: 5_050_000n }); // covers the principal but not principal + fees
    const res = await h.place.handle(h.order('pr8', 'b8', { side: 'buy', price: { token: 'USDC', amount: '5000000' }, maxStallFeeBp: 100 }));
    expect(res?.order?.state ?? 'REJECTED').not.toBe('OPEN');
    expect(await h.db.prisma.marketOrder.count({ where: { planetId: 'pr8', state: { in: ['OPEN', 'PARTIAL'] } } })).toBe(0);
  });
});

describe('progression facts from a real FINAL trade (W13-27)', () => {
  it('Merchant counts for buyer and seller, Port Authority only for the stall owner; a replay never double counts', async () => {
    const t = await h.matched(2);
    await h.relay.pollOnce();
    const trade = (await h.trades.find(t.tradeId))!;
    expect(trade.state).toBe('FINAL');
    const bus = new EventBus();
    const forwarder = new ProgressionEventForwarder(bus);
    forwarder.registerColony(t.seller, 'player-seller');
    forwarder.registerColony(t.buyer, 'player-buyer');
    const engine = new ProgressionEngine(h.db.prisma, { availableFamilies: () => new Set(ACHIEVEMENT_FAMILY_IDS) } as FamilyAvailabilityService);
    const producer = new MarketProgressionProducer(bus, new FactsUpdaterService(new FactsStore(h.db.prisma), bus, undefined, engine), forwarder, new FlagsService({ TA_WAVES: 'all' } as never));
    producer.onModuleInit();
    const emit = (kind: string, colonyId: string, extra: Record<string, unknown>): boolean =>
      bus.emit('planet.event', { planetId: trade.planetId, tick: 3, kind, severity: 'info', colonyIds: [colonyId], data: { tradeId: trade.tradeId, colonyId, ...extra } } as never);
    const settled = (colonyId: string, role: string): boolean => emit('tradeSettled', colonyId, {
      role, base: trade.base, amount: Number(trade.amount), quote: trade.quote, notional: trade.notional.toFixed(), platformFee: trade.platformFee.toFixed(), stallFee: trade.stallFee.toFixed(), stallFeeBp: trade.stallFeeBp, makerSide: trade.makerSide,
    });
    for (let replay = 0; replay < 2; replay++) {
      settled(t.buyer, 'buyer'); settled(t.seller, 'seller');
      emit('feeEarned', t.seller, { token: 'USDC', amount: trade.stallFee.toFixed(), bp: trade.stallFeeBp });
    }
    await producer.idle();
    const fact = async (player: string, family: string) => (await h.db.prisma.playerFact.findUnique({ where: { playerId_family: { playerId: player, family } } }))?.value ?? 0;
    expect(await fact('player-buyer', 'merchant')).toBe(1);
    expect(await fact('player-seller', 'merchant')).toBe(1);
    expect(await fact('player-seller', 'port-authority')).toBe(1);
    expect(await fact('player-buyer', 'port-authority')).toBe(0);
  });
});
