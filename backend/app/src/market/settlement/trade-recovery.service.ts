import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { isResourceToken, marketTradeOpId, type MarketTokenKey } from '@terra/contracts';
import { withTransaction, type PrismaClient, type TransactionClient } from '@terra/db';
import { databaseEnabled } from '../../core/persistence.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { PRISMA } from '../../db/db.module.js';
import { ChainOutboxRepository, type ClaimedRow } from '../../near/application/outbox/chain-outbox.repository.js';
import { OutboxListeners } from '../../near/application/outbox/outbox-listeners.js';
import { IntentsPort } from '../../near/application/ports/intents.port.js';
import { MarketBooks } from '../book/market-books.js';
import { isBookable, type MarketOrderRecord } from '../book/market-order.record.js';
import { MarketOrderRepository } from '../book/market-order.repository.js';
import { MarketMetrics } from '../telemetry/market-metrics.js';
import { MarketSimGateway } from '../orders/market-sim-gateway.js';
import { OrderFunds } from '../orders/order-funds.js';
import { PlaceOrderService } from '../orders/place-order.service.js';
import { IntentTradeRepository } from './intent-trade.repository.js';
import { TradeSettlement } from './trade-settlement.service.js';
import { chargeFillBuckets, treasuryShareInBuckets } from '@terra/sim/systems/trade/market-batch';
import type { FeeBuckets } from '@terra/sim/systems/trade/market-fees';
import type { OrderRollback, TradePlan } from './trade-plan.js';

/** Errors after which the chain definitely did not (and will not) apply the batch. Everything else is ambiguous. */
export const FINAL_FAILURE_CODES: readonly string[] = [
  'NEAR_INTENT_BAD_SIGNATURE', 'NEAR_INTENT_DIFF_NOT_ZERO', 'NEAR_INTENT_EXPIRED', 'NEAR_INTENT_NONCE_REUSED',
  'NEAR_INSUFFICIENT_BALANCE', 'NEAR_ACCOUNT_NOT_FOUND', 'NEAR_PROVIDER_REJECTED',
];
export const RECONCILE_MS = 30_000;

const codeOf = (error: string): string | undefined => /^(NEAR_[A-Z_]+)/.exec(error)?.[1];

/** Replays one surviving fill onto the buyer buckets, including the treasury carve when that fill stored an account. */
function rebuiltFillBuckets(
  buckets: FeeBuckets,
  t: { quote: string; notional: { toFixed(): string }; platformFeeBp: number; platformAccountId: string; policyVersion: string; stallFeeBp: number; stallAccountId: string; treasuryAccountId: string | null },
  share: number | null,
): FeeBuckets {
  const treasury = t.treasuryAccountId && share !== null
    ? { enabled: true, shareBp: share, accountId: t.treasuryAccountId }
    : { enabled: false, shareBp: 0, accountId: '' };
  return chargeFillBuckets(buckets, {
    quote: t.quote, notional: BigInt(t.notional.toFixed()), platformFeeBp: t.platformFeeBp, platformAccountId: t.platformAccountId,
    policyVersion: t.policyVersion, stallFeeBp: t.stallFeeBp, stallAccountId: t.stallAccountId, treasury,
  }).buckets;
}
const planOf = (row: { readonly payload: unknown }): TradePlan | undefined => (row.payload as { trade?: TradePlan }).trade;
const isTradeExecute = (row: Pick<ClaimedRow, 'opId' | 'port' | 'method'>): boolean => row.port === 'Intents' && row.method === 'execute' && row.opId.startsWith('trade:');

export interface FailOutcome {
  /** False when the trade had already reached FINAL/FAILED (nothing was undone). */
  readonly failed: boolean;
  readonly reactivated: string[];
  readonly terminated: string[];
}

/**
 * Settlement recovery state machine (W13-14). A trade's outbox row is the single execution: it is never re-enqueued.
 *  - final failure (`FINAL_FAILURE_CODES`): the row is abandoned, the trade goes `FAILED` and in the SAME transaction both orders
 *    lose exactly what that fill added (fill, cumulative notional, fee buckets) and regain its reservation, under row locks and
 *    after re-checking funds. An order that is expired or can no longer cover it ends (EXPIRED / REJECTED / CANCELLED) and the sim
 *    mirror is released (`settlement_failed`). Executable orders are matched again.
 *  - ambiguous outcome (`NEAR_UNAVAILABLE`, injected failure, retries exhausted): the trade is `UNKNOWN`; reservations and the
 *    in-flight debit stay held. `reconcile()` (boot + every 30 s) re-runs `execute` with the same opId, which the verifier answers
 *    with the stored receipt, and finalizes or fails the trade only once the answer is definite.
 */
@Injectable()
export class TradeRecovery implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(TradeRecovery.name);
  private off: (() => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly trades: IntentTradeRepository,
    private readonly orders: MarketOrderRepository,
    private readonly books: MarketBooks,
    private readonly outbox: ChainOutboxRepository,
    private readonly funds: OrderFunds,
    private readonly gateway: MarketSimGateway,
    private readonly settlement: TradeSettlement,
    private readonly place: PlaceOrderService,
    private readonly intents: IntentsPort,
    private readonly listeners: OutboxListeners,
    private readonly metrics: MarketMetrics,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  onModuleInit(): void {
    this.off ??= this.listeners.onFailed((row, error, dead) => this.onRowFailed(row, error, dead));
    if (!databaseEnabled(this.env)) return;
    void this.reconcile().catch((e: unknown) => this.log.warn(`trade reconcile failed: ${e instanceof Error ? e.message : String(e)}`));
    if (this.env.NODE_ENV !== 'test') this.timer ??= setInterval(() => void this.reconcile().catch(() => undefined), RECONCILE_MS);
  }

  onModuleDestroy(): void {
    this.off?.();
    this.off = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async onRowFailed(row: ClaimedRow, error: string, dead: boolean): Promise<void> {
    if (!isTradeExecute(row)) return;
    const plan = planOf(row);
    if (!plan) return;
    const code = codeOf(error);
    if (code && FINAL_FAILURE_CODES.includes(code)) {
      await this.outbox.abandon(row.opId);
      await this.failTrade(plan, error);
    } else if (dead || code === 'NEAR_UNAVAILABLE') {
      await this.trades.markUnknown(plan.tradeId, error);
    }
  }

  /** Resolves every `UNKNOWN` trade it can; returns how many reached FINAL or FAILED. */
  async reconcile(): Promise<number> {
    let n = 0;
    for (const t of await this.trades.listUnknown()) {
      const opId = marketTradeOpId(t.tradeId);
      const row = await this.outbox.find(opId);
      const plan = row ? planOf(row) : undefined;
      if (!row || !plan) continue;
      if (row.status === 'DONE') { if (await this.settlement.finalize(plan, row.txHash)) n++; continue; }
      try {
        const receipt = await this.intents.execute({ opId, intents: (row.payload as { intents: never[] }).intents });
        await this.outbox.markDoneByOpId(opId, receipt, receipt.txHash);
        if (await this.settlement.finalize(plan, receipt.txHash)) n++;
      } catch (e) {
        const errorCode = (e as { errorCode?: string }).errorCode ?? '';
        const text = `${errorCode}: ${e instanceof Error ? e.message : String(e)}`;
        const final = FINAL_FAILURE_CODES.includes(errorCode);
        if (!final) continue; // still ambiguous: stay UNKNOWN, keep everything held
        await this.outbox.abandon(opId);
        if ((await this.failTrade(plan, text)).failed) n++;
      }
    }
    return n;
  }

  /** Undoes a definitely-failed trade atomically, then re-matches the orders that are executable again. */
  async failTrade(plan: TradePlan, error: string): Promise<FailOutcome> {
    const res = await withTransaction(this.prisma, (tx) => this.rollBack(tx, plan, error));
    if (!res.failed) return res;
    this.metrics.batchFailed(codeOf(error) ?? 'unknown');
    const ids = plan.rollback.map((r) => r.orderId);
    await this.books.sync(...ids);
    for (const rel of res.releases) {
      this.gateway.release({ planetId: rel.order.planetId, colonyId: rel.order.colonyId, colonyIndex: rel.order.colonyIndex }, {
        ref: rel.order.ref, orderId: rel.order.orderId, deltas: rel.deltas, reason: 'settlement_failed',
      });
    }
    for (const id of res.reactivated) await this.place.matchAndSettle(id);
    return { failed: true, reactivated: res.reactivated, terminated: res.terminated };
  }

  private async rollBack(tx: TransactionClient, plan: TradePlan, error: string) {
    const none = { failed: false, reactivated: [] as string[], terminated: [] as string[], releases: [] as Array<{ order: MarketOrderRecord; deltas: Record<string, number> }> };
    const locked = await this.orders.lockForUpdate(plan.rollback.map((r) => r.orderId), tx);
    if (!(await this.trades.fail(plan.tradeId, error, tx))) return none;
    const out = { ...none, failed: true };
    for (const rb of plan.rollback) {
      const row = locked.find((o) => o.orderId === rb.orderId);
      if (!row) continue;
      const end = await this.restore(tx, row, rb, plan.tradeId);
      if (end.active) out.reactivated.push(row.orderId);
      else { out.terminated.push(row.orderId); out.releases.push({ order: row, deltas: end.release }); }
    }
    return out;
  }

  /**
   * Fee buckets of a buyer order without the rolled-back fill: re-charged from scratch over its remaining (non-failed) fills in
   * order with the same cumulative-floor rule, so no rounding dust is left behind (a subtraction would keep the failed fill's floors).
   */
  private async rebuiltBuckets(tx: TransactionClient, o: MarketOrderRecord, rb: OrderRollback, failedTradeId: string): Promise<Record<string, { base: string; fee: string }>> {
    if (Object.keys(rb.buckets).length === 0) return { ...o.feeBuckets };
    const fills = await tx.intentTrade.findMany({
      where: { state: { not: 'FAILED' }, tradeId: { not: failedTradeId }, OR: [{ makerOrderId: o.orderId, makerSide: 'buy' }, { takerOrderId: o.orderId, makerSide: 'sell' }] },
      orderBy: { id: 'asc' },
    });
    const share = treasuryShareInBuckets(o.feeBuckets);
    let buckets: FeeBuckets = {};
    for (const t of fills) buckets = rebuiltFillBuckets(buckets, t, share);
    return { ...buckets };
  }

  /** Reverses one fill on one locked order; returns whether the order is executable again or ended (and what to release in the sim). */
  private async restore(tx: TransactionClient, o: MarketOrderRecord, rb: OrderRollback, failedTradeId: string): Promise<{ active: boolean; release: Record<string, number> }> {
    const filled = o.filled - BigInt(rb.qty);
    const fill = { filled, cumNotional: o.cumNotional - BigInt(rb.notional), feeBuckets: await this.rebuiltBuckets(tx, o, rb, failedTradeId) };
    const restoreP = BigInt(rb.restorePrincipal);
    const restoreF = BigInt(rb.restoreFees);
    const token = (o.side === 'sell' ? o.base : o.quote) as MarketTokenKey;
    const wasActive = isBookable(o.state) || o.state === 'FILLED';
    const expired = o.expiresAt.getTime() <= Date.now();
    let next: string | null = null;
    if (wasActive && !expired) {
      const view = await this.funds.view(o.accountId, token, tx);
      if (view.free >= restoreP + restoreF) {
        const state = filled === 0n ? 'OPEN' : 'PARTIAL';
        await this.orders.updateFill(o.orderId, { ...fill, state }, tx);
        await this.orders.updateReservation(o.orderId, { reservedPrincipal: o.reservedPrincipal + restoreP, reservedFees: o.reservedFees + restoreF, state }, tx);
        return { active: true, release: {} };
      }
      next = filled === 0n ? 'REJECTED' : 'CANCELLED';
    } else if (wasActive) next = 'EXPIRED';
    const stillHeld = o.reservedPrincipal + o.reservedFees;
    await this.orders.updateFill(o.orderId, { ...fill, state: next ?? o.state }, tx);
    await this.orders.updateReservation(o.orderId, { reservedPrincipal: 0n, reservedFees: 0n, state: next ?? o.state }, tx);
    if (next) await this.orders.setState(o.orderId, next, 'settlement_failed', tx);
    const units = restoreP + restoreF + stillHeld;
    return { active: false, release: isResourceToken(token) && units > 0n ? { [token]: Number(units) } : {} };
  }
}
