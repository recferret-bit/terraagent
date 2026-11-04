import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { eventDef, marketDepositOpId, marketToken, isResourceToken, pairId, type MarketTokenKey, type RejectCode, type ResourceKey } from '@terra/contracts';
import { withTransaction, type DbClient, type PrismaClient, type TransactionClient } from '@terra/db';
import { EventBus } from '../../bus/event-bus.js';
import type { PlanetEventOf } from '../../bus/channels.js';
import { databaseEnabled } from '../../core/persistence.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { PRISMA } from '../../db/db.module.js';
import { ChainOutboxRepository } from '../../near/application/outbox/chain-outbox.repository.js';
import { MarketBooks } from '../book/market-books.js';
import type { MarketOrderRecord } from '../book/market-order.record.js';
import { MarketOrderRepository } from '../book/market-order.repository.js';
import { MarketMatcher } from '../matching/market-matcher.service.js';
import { resolveMarketAccountId } from './colony-account.js';
import { MarketFillsHook } from './market-fills.hook.js';
import { MarketPolicyProvider, PLATFORM_ACCOUNT_ID } from './market-policy.provider.js';
import { MarketSimGateway, type SimTarget } from './market-sim-gateway.js';
import { OrderFunds, requirementOf, type FundsView, type Requirement } from './order-funds.js';

type Requested = PlanetEventOf<'marketOrderRequested'>;

export interface PlaceOrderResult {
  readonly order: MarketOrderRecord;
  /** False for a replayed event (nothing was reserved or enqueued again). */
  readonly created: boolean;
  /** Set when the order was REJECTED under lock. */
  readonly rejected?: { readonly code: RejectCode; readonly detail: string };
  /** Chain units enqueued for the verifier deposit (0 when funds were already there or the token is not a resource). */
  readonly depositChain: bigint;
}

/** Deterministic order id of a sim ref on one planet (refs repeat across planets: every scenario planet has `col_0`). */
export const orderIdOf = (planetId: string, ref: string): string => `mo_${createHash('sha256').update(`${planetId}\u0000${ref}`).digest('hex').slice(0, 40)}`;

/**
 * Acts on the sim's `marketOrderRequested` (W13-09): in one transaction it creates the order idempotently with the policy
 * pinned, serializes on the colony account's funds (advisory lock + `FOR UPDATE` on its open orders), re-checks the open-order
 * limit and the free funds, reserves principal and fees and enqueues the verifier deposit (`market-deposit:{ref}`). After
 * commit it syncs the book, answers the sim (`market.reserve` / `market.release` rejected) and matches.
 */
@Injectable()
export class PlaceOrderService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(PlaceOrderService.name);
  private stop: (() => void) | null = null;

  constructor(
    private readonly bus: EventBus,
    private readonly repo: MarketOrderRepository,
    private readonly books: MarketBooks,
    private readonly matcher: MarketMatcher,
    private readonly funds: OrderFunds,
    private readonly outbox: ChainOutboxRepository,
    private readonly policy: MarketPolicyProvider,
    private readonly gateway: MarketSimGateway,
    private readonly fills: MarketFillsHook,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  onModuleInit(): void {
    this.stop ??= this.bus.onPlanetEvent('marketOrderRequested', (e) => this.onRequested(e), { module: 'PlaceOrderService' });
  }

  onModuleDestroy(): void {
    this.stop?.();
    this.stop = null;
  }

  private onRequested(event: Requested): void {
    void this.handle(event).catch((err: unknown) => this.log.warn(`place order failed: ${err instanceof Error ? err.message : String(err)}`));
  }

  async handle(event: Requested): Promise<PlaceOrderResult | null> {
    if (!databaseEnabled(this.env)) return null;
    const d = eventDef('marketOrderRequested').data.parse(event.data);
    const target: SimTarget = { planetId: event.planetId, colonyId: d.colonyId, colonyIndex: d.colonyIndex };
    const accountId = await resolveMarketAccountId(this.prisma, d.colonyId, d.playerId ?? null, event.planetId, d.colonyIndex);
    const result = await withTransaction(this.prisma, (tx) => this.place(tx, event.planetId, d, accountId));
    await this.books.sync(result.order.orderId);
    this.answerSim(target, result);
    if (result.created && !result.rejected) await this.matchAndHand(result.order.orderId);
    return result;
  }

  private answerSim(target: SimTarget, r: PlaceOrderResult): void {
    const ref = r.order.ref;
    if (r.rejected) {
      this.gateway.release(target, { ref, orderId: r.order.orderId, deltas: {}, reason: 'rejected', code: r.rejected.code, detail: r.rejected.detail.slice(0, 200) });
    } else if (r.order.state === 'OPEN' || r.order.state === 'PARTIAL') {
      this.gateway.reserve(target, { ref, orderId: r.order.orderId, deltas: simDeltas(r.order) });
    }
  }

  /** Matches the new order and hands the fills to the hook inside one transaction (the matcher's locks stay held). */
  private async matchAndHand(orderId: string): Promise<void> {
    try {
      const touched = await withTransaction(this.prisma, async (tx) => {
        const outcome = await this.matcher.matchOrder(orderId, tx);
        return outcome.fills.length > 0 ? this.fills.onFills(outcome, tx) : [];
      });
      if (touched.length > 0) await this.books.sync(...touched);
    } catch (err) {
      this.log.warn(`matching ${orderId} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async place(tx: TransactionClient, planetId: string, d: Requested['data'], accountId: string): Promise<PlaceOrderResult> {
    const cfg = this.policy.current();
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`market-funds:${accountId}`}, 0))`;
    const claimed = (await tx.nearColonyAccount.findUnique({ where: { accountId }, select: { claimedAt: true } }))?.claimedAt != null;
    const maxStall = d.maxStallFeeBp ?? cfg.stallFeeMaxBp;
    const { order, created } = await this.repo.createFromRequest({
      orderId: orderIdOf(planetId, d.ref), ref: d.ref, planetId, pair: pairId(d.resource, d.price.token), base: d.resource, quote: d.price.token,
      side: d.side, colonyId: d.colonyId, colonyIndex: d.colonyIndex, playerId: d.playerId ?? null, accountId,
      stallColonyId: d.colonyId, stallAccountId: accountId, stallHubEntityId: d.hubEntityId, platformAccountId: PLATFORM_ACCOUNT_ID,
      amount: BigInt(d.amount), priceAmount: BigInt(d.price.amount), fillPolicy: claimed ? 'all_or_nothing' : 'partial',
      policyVersion: cfg.policyVersion, policyHash: cfg.policyHash, platformFeeBp: cfg.platformFeeBp, stallFeeBp: d.stallFeeBp,
      maxStallFeeBp: d.side === 'buy' ? maxStall : null, ttlS: d.ttlS, expiresAt: new Date(Date.now() + d.ttlS * 1000),
    }, tx);
    if (!created) return { order, created, depositChain: 0n };

    await this.repo.lockForUpdate((await this.repo.listOpenByColony(d.colonyId, tx)).map((o) => o.orderId), tx);
    const open = (await this.repo.listOpenByColony(d.colonyId, tx)).length;
    if (open >= cfg.openOrderLimit) return this.reject(tx, order, 'order_limit', `At most ${cfg.openOrderLimit} open orders.`);
    const need = requirementOf({
      side: d.side, base: d.resource, quote: d.price.token, amount: BigInt(d.amount), priceAmount: BigInt(d.price.amount),
      platformFeeBp: cfg.platformFeeBp, maxStallFeeBp: maxStall,
    });
    const view = await this.funds.view(accountId, d.colonyId, need.token, tx);
    const total = need.principal + need.fees;
    if (view.free < total) return this.reject(tx, order, 'insufficient_cargo', `Need ${total} ${need.token} (incl. fees), ${view.free} free.`);

    const reserved = await this.repo.updateReservation(order.orderId, { reservedPrincipal: need.principal, reservedFees: need.fees, state: 'OPEN' }, tx);
    const depositChain = await this.enqueueDeposit(tx, reserved, accountId, need, view);
    return { order: reserved, created, depositChain };
  }

  private async reject(tx: TransactionClient, order: MarketOrderRecord, code: RejectCode, detail: string): Promise<PlaceOrderResult> {
    const rejected = await this.repo.setState(order.orderId, 'REJECTED', `${code}: ${detail}`, tx);
    return { order: rejected, created: true, rejected: { code, detail }, depositChain: 0n };
  }

  /**
   * Moves the part of the lock still in the cargo account to the verifier. Funds at the verifier count together with deposits
   * already enqueued but not landed (`pendingDepositUnits`), minus what the colony's other open orders lock, so concurrent
   * orders neither double-use nor over-deposit.
   */
  private async enqueueDeposit(tx: TransactionClient, order: MarketOrderRecord, accountId: string, need: Requirement, view: FundsView): Promise<bigint> {
    if (!isResourceToken(need.token)) return 0n;
    const inflight = await pendingDepositUnits(tx, accountId, need.token);
    const tradeDebit = await this.funds.inFlightDebit(accountId, need.token, tx);
    const covered = view.verifier + inflight;
    const locked = view.reserved + tradeDebit;
    const verifierFree = covered > locked ? covered - locked : 0n;
    const shortfall = need.principal + need.fees - verifierFree;
    const units = shortfall <= 0n ? 0n : shortfall < view.cargo ? shortfall : view.cargo;
    if (units === 0n) return 0n;
    const chain = OrderFunds.chainUnits(need.token, units);
    await this.outbox.enqueue({
      opId: marketDepositOpId(order.ref), port: 'Intents', method: 'deposit',
      payload: { accountId, tokenId: marketToken(need.token).verifierId, amount: chain.toString(), orderRef: order.ref, orderId: order.orderId },
    }, tx);
    return chain;
  }
}

/** Market atomic units of `token` the account has in market-deposit outbox rows that have not landed yet (not DONE, not DEAD). */
export async function pendingDepositUnits(db: DbClient, accountId: string, token: MarketTokenKey): Promise<bigint> {
  const rows = await db.chainOutbox.findMany({
    where: { port: 'Intents', method: 'deposit', status: { in: ['PENDING', 'RUNNING', 'FAILED'] }, opId: { startsWith: 'market-deposit:' } },
    select: { payload: true },
  });
  const verifierId = marketToken(token).verifierId;
  let chain = 0n;
  for (const r of rows) {
    const p = r.payload as { accountId?: string; tokenId?: string; amount?: string };
    if (p.accountId === accountId && p.tokenId === verifierId && p.amount) chain += BigInt(p.amount);
  }
  return chain / OrderFunds.chainUnits(token, 1n);
}

/** Whole-unit in-orbit resource reservations the sim mirrors: a sell locks base, a barter buy locks the quote resource. */
export function simDeltas(o: MarketOrderRecord): Partial<Record<ResourceKey, number>> {
  const token = o.side === 'sell' ? o.base : o.quote;
  if (!isResourceToken(token as never)) return {};
  return { [token]: Number(o.reservedPrincipal + o.reservedFees) } as Partial<Record<ResourceKey, number>>;
}
