import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { marketTradeOpId } from '@terra/contracts';
import type { TransactionClient } from '@terra/db';
import type { TradeBatch } from '@terra/sim/systems/trade/market-batch';
import type { Fill } from '@terra/sim/systems/trade/market-matcher';
import { ChainOutboxRepository } from '../../near/application/outbox/chain-outbox.repository.js';
import { IntentsPort } from '../../near/application/ports/intents.port.js';
import type { MarketOrderRecord } from '../book/market-order.record.js';
import { MarketOrderRepository } from '../book/market-order.repository.js';
import type { MatchOutcome } from '../matching/market-matcher.service.js';
import { MarketFillsHook } from '../orders/market-fills.hook.js';
import { MarketPolicyProvider } from '../orders/market-policy.provider.js';
import { isOrganicFill } from './organic.js';
import { buildFillBatch } from './batch-builder.js';
import { IntentTradeRepository } from './intent-trade.repository.js';
import { planParties, rollbackOf, type TradePlan } from './trade-plan.js';
import { signTradeLegs, TRADE_INTENT_TTL_MS } from './trade-intents.js';
import { legsToJson } from '@terra/sim/systems/trade/market-batch';

/** Treasury account of the W22 share (only used while W22 is on; the carve-out is 0 before). */
export const TREASURY_ACCOUNT_ID = 'treasury.terraagent.mock';

/** Deterministic trade id of one fill: taker, maker and the taker's filled quantity before it identify it. */
export const tradeIdOf = (fill: Fill, takerFilledBefore: bigint): string =>
  `tr_${createHash('sha256').update(`${fill.takerOrderId}\u0000${fill.makerOrderId}\u0000${takerFilledBefore}`).digest('hex').slice(0, 40)}`;

const isPlayerPair = (a: MarketOrderRecord, b: MarketOrderRecord): boolean =>
  isOrganicFill({ actorKind: a.actorKind, colonyId: a.colonyId, ownerId: a.playerId }, { actorKind: b.actorKind, colonyId: b.colonyId, ownerId: b.playerId });

/**
 * W13-13 fills hook, run in the matcher's transaction: per fill it builds the exact batch, persists both orders' fills
 * and reservations, inserts the `PENDING` trade and enqueues the outbox `Intents.execute` row `trade:{tradeId}` with the
 * signed intents and the plan the FINAL step needs. Nothing moves on chain until the relay runs that row.
 */
@Injectable()
export class SettlementFillsHook extends MarketFillsHook {
  constructor(
    private readonly orders: MarketOrderRepository,
    private readonly trades: IntentTradeRepository,
    private readonly outbox: ChainOutboxRepository,
    private readonly intents: IntentsPort,
    private readonly policy: MarketPolicyProvider,
  ) {
    super();
  }

  async onFills(outcome: MatchOutcome, tx: TransactionClient): Promise<string[]> {
    const cur = new Map<string, MarketOrderRecord>(outcome.makers);
    if (outcome.incoming) cur.set(outcome.incoming.orderId, outcome.incoming);
    const touched = new Set<string>();
    for (const fill of outcome.fills) {
      const taker = cur.get(fill.takerOrderId)!;
      const tradeId = await this.freshTradeId(tradeIdOf(fill, taker.filled), tx);
      const batch = buildFillBatch({ tradeId, fill, orders: cur, treasury: { enabled: false, shareBp: this.policy.current().treasuryShareBp, accountId: TREASURY_ACCOUNT_ID } });
      const buyer = cur.get(fill.buyerOrderId)!;
      const seller = cur.get(fill.sellerOrderId)!;
      const maker = cur.get(fill.makerOrderId)!;
      const rollback = [rollbackOf(buyer, batch.buyer), rollbackOf(seller, batch.seller)];
      cur.set(buyer.orderId, await this.persist(buyer, batch.buyer, tx));
      cur.set(seller.orderId, await this.persist(seller, batch.seller, tx));
      touched.add(buyer.orderId).add(seller.orderId);
      await this.enqueue(tx, batch, buyer, seller, maker, rollback);
    }
    return [...touched];
  }

  /**
   * A fill that is matched again after its first trade FAILED (orders restored, same taker/maker/filled-before) must be a NEW trade:
   * the deterministic id would hit the FAILED row, `insert` would report "not created" and no outbox row would ever settle the fill.
   */
  private async freshTradeId(base: string, tx: TransactionClient): Promise<string> {
    let id = base;
    for (let n = 1; (await this.trades.find(id, tx))?.state === 'FAILED'; n++) id = `${base}~${n}`;
    return id;
  }

  private async persist(o: MarketOrderRecord, u: TradeBatch['buyer'], tx: TransactionClient): Promise<MarketOrderRecord> {
    const state = u.filled === o.amount ? 'FILLED' : 'PARTIAL';
    await this.orders.updateFill(o.orderId, { filled: u.filled, cumNotional: u.cumNotional, feeBuckets: u.feeBuckets, state }, tx);
    return this.orders.updateReservation(o.orderId, { reservedPrincipal: u.reservedPrincipal, reservedFees: u.reservedFees, state }, tx);
  }

  private async enqueue(tx: TransactionClient, batch: TradeBatch, buyer: MarketOrderRecord, seller: MarketOrderRecord, maker: MarketOrderRecord, rollback: TradePlan['rollback']): Promise<void> {
    const cfg = this.policy.current();
    const organic = isPlayerPair(buyer, seller);
    const pair = `${batch.base}/${batch.quote}`;
    const { created } = await this.trades.insert({
      tradeId: batch.tradeId, planetId: buyer.planetId, pair, base: batch.base, quote: batch.quote, makerOrderId: maker.orderId,
      takerOrderId: maker.orderId === buyer.orderId ? seller.orderId : buyer.orderId, makerSide: maker.side,
      buyerColonyId: buyer.colonyId, sellerColonyId: seller.colonyId, buyerAccountId: buyer.accountId, sellerAccountId: seller.accountId,
      stallColonyId: maker.stallColonyId, stallAccountId: maker.stallAccountId, platformAccountId: buyer.platformAccountId,
      treasuryAccountId: batch.treasuryAllocation > 0n ? TREASURY_ACCOUNT_ID : null,
      amount: batch.qty, notional: batch.notional, platformFee: batch.platformFee, stallFee: batch.stallFee, treasuryAllocation: batch.treasuryAllocation,
      platformFeeBp: batch.platformFeeBp, stallFeeBp: batch.stallFeeBp, policyVersion: cfg.policyVersion, policyHash: cfg.policyHash,
      legs: legsToJson(batch.legs), batchHash: batch.batchHash, buyerActorKind: buyer.actorKind, sellerActorKind: seller.actorKind, organic,
    }, tx);
    if (!created) return;
    const plan: TradePlan = {
      tradeId: batch.tradeId, planetId: buyer.planetId, base: batch.base, quote: batch.quote, qty: Number(batch.qty), notional: batch.notional.toString(),
      platformFee: batch.platformFee.toString(), stallFee: batch.stallFee.toString(), stallFeeBp: batch.stallFeeBp, makerSide: maker.side, pair, organic,
      makerKind: maker.actorKind, treasuryFee: batch.treasuryAllocation.toString(),
      parties: planParties(batch, buyer, seller, maker), rollback,
    };
    const intents = await signTradeLegs(this.intents, batch.tradeId, batch.legs, Date.now() + TRADE_INTENT_TTL_MS);
    await this.outbox.enqueue({ opId: marketTradeOpId(batch.tradeId), port: 'Intents', method: 'execute', payload: { intents, trade: plan } }, tx);
  }
}
