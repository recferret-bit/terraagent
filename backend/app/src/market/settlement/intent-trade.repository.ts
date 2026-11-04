import { Inject, Injectable } from '@nestjs/common';
import { RepositoryBase, type DbClient, type PrismaClient } from '@terra/db';
import { PRISMA } from '../../db/db.module.js';
import { toDecimalInput } from '../book/decimal.js';

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

  /** `PENDING`/`SUBMITTED` -> `FINAL` once; returns false when it already was FINAL (a replay). */
  async finalize(tradeId: string, txHash: string | null, tx?: DbClient): Promise<boolean> {
    const r = await this.db(tx).intentTrade.updateMany({
      where: { tradeId, state: { not: 'FINAL' } },
      data: { state: 'FINAL', txHash, settledAt: new Date(), lastError: null },
    });
    return r.count === 1;
  }

  /** Trades whose settlement has not finished (their legs are still to be debited at the verifier). */
  inFlight(tx?: DbClient): Promise<TradeRow[]> {
    return this.db(tx).intentTrade.findMany({ where: { state: { in: ['PENDING', 'SUBMITTED'] } }, orderBy: { id: 'asc' } });
  }
}
