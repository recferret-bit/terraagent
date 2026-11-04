import { Inject, Injectable } from '@nestjs/common';
import { RepositoryBase, type DbClient, type PrismaClient } from '@terra/db';
import { PRISMA } from '../../db/db.module.js';
import { toDecimalInput } from '../book/decimal.js';

/** Trades whose settlement has not reached a final answer; their legs still count as debits and their reservations stay held. */
export const OPEN_TRADE_STATES = ['PENDING', 'SUBMITTED', 'UNKNOWN'];

type TradeRow = NonNullable<Awaited<ReturnType<PrismaClient['intentTrade']['findUnique']>>>;

export interface NewIntentTrade {
  readonly tradeId: string;
  readonly planetId: string;
  readonly pair: string;
  readonly base: string;
  readonly quote: string;
  readonly makerOrderId: string;
  readonly takerOrderId: string;
  readonly makerSide: 'buy' | 'sell';
  readonly buyerColonyId: string;
  readonly sellerColonyId: string;
  readonly buyerAccountId: string;
  readonly sellerAccountId: string;
  readonly stallColonyId: string;
  readonly stallAccountId: string;
  readonly platformAccountId: string;
  readonly treasuryAccountId?: string | null;
  readonly amount: bigint;
  readonly notional: bigint;
  readonly platformFee: bigint;
  readonly stallFee: bigint;
  readonly treasuryAllocation: bigint;
  readonly platformFeeBp: number;
  readonly stallFeeBp: number;
  readonly policyVersion: string;
  readonly policyHash: string;
  readonly legs: object;
  readonly batchHash: string;
  readonly buyerActorKind: string;
  readonly sellerActorKind: string;
  readonly organic: boolean;
}

/** Persistence of `chain.intent_trade`. A trade reaches FINAL exactly once (`finalize` is a conditional update). */
@Injectable()
export class IntentTradeRepository extends RepositoryBase {
  constructor(@Inject(PRISMA) prisma: PrismaClient) {
    super(prisma);
  }

  /** Idempotent on `tradeId`. */
  async insert(t: NewIntentTrade, tx?: DbClient): Promise<{ trade: TradeRow; created: boolean }> {
    const db = this.db(tx);
    const { count } = await db.intentTrade.createMany({
      data: [{
        ...t,
        amount: toDecimalInput(t.amount), notional: toDecimalInput(t.notional), platformFee: toDecimalInput(t.platformFee),
        stallFee: toDecimalInput(t.stallFee), treasuryAllocation: toDecimalInput(t.treasuryAllocation), legs: t.legs, state: 'PENDING',
      }],
      skipDuplicates: true,
    });
    return { trade: await db.intentTrade.findUniqueOrThrow({ where: { tradeId: t.tradeId } }), created: count > 0 };
  }

  find(tradeId: string, tx?: DbClient): Promise<TradeRow | null> {
    return this.db(tx).intentTrade.findUnique({ where: { tradeId } });
  }

  /** `PENDING`/`SUBMITTED`/`UNKNOWN` -> `FINAL` once (a FAILED trade never becomes FINAL); returns false when it already was FINAL (a replay). */
  async finalize(tradeId: string, txHash: string | null, tx?: DbClient): Promise<boolean> {
    const r = await this.db(tx).intentTrade.updateMany({
      where: { tradeId, state: { in: OPEN_TRADE_STATES } },
      data: { state: 'FINAL', txHash, settledAt: new Date(), lastError: null },
    });
    return r.count === 1;
  }

  /** Trades whose settlement has not finished (their legs are still to be debited at the verifier). */
  inFlight(tx?: DbClient): Promise<TradeRow[]> {
    return this.db(tx).intentTrade.findMany({ where: { state: { in: OPEN_TRADE_STATES } }, orderBy: { id: 'asc' } });
  }

  /** Open -> `FAILED` once (the chain definitely did not apply the batch). */
  async fail(tradeId: string, error: string, tx?: DbClient): Promise<boolean> {
    const r = await this.db(tx).intentTrade.updateMany({ where: { tradeId, state: { in: OPEN_TRADE_STATES } }, data: { state: 'FAILED', lastError: error.slice(0, 400) } });
    return r.count === 1;
  }

  /** `PENDING`/`SUBMITTED` -> `UNKNOWN` (outcome ambiguous: quarantined, nothing is released). */
  async markUnknown(tradeId: string, error: string, tx?: DbClient): Promise<boolean> {
    const r = await this.db(tx).intentTrade.updateMany({ where: { tradeId, state: { in: ['PENDING', 'SUBMITTED'] } }, data: { state: 'UNKNOWN', lastError: error.slice(0, 400) } });
    return r.count === 1;
  }

  listUnknown(): Promise<TradeRow[]> {
    return this.prisma.intentTrade.findMany({ where: { state: 'UNKNOWN' }, orderBy: { id: 'asc' } });
  }
}
