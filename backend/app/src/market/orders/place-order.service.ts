import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { eventDef, marketDepositOpId, type ActorKind, marketToken, isResourceToken, pairId, type RejectCode, type ResourceKey } from '@terra/contracts';
import { withTransaction, type PrismaClient, type TransactionClient } from '@terra/db';
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
import { OrderFunds, requirementOf, type Requirement } from './order-funds.js';

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

/** Options of `handle`: `fixture` orders (dev seed bots, W13-30) are labelled `actorKind` fixture and never answered to the sim. */
export interface PlaceOptions {
  readonly actorKind?: ActorKind;
  readonly answerSim?: boolean;
}

export const orderIdOfRef = (ref: string): string => `mo_${createHash('sha256').update(ref).digest('hex').slice(0, 40)}`;

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

  async handle(event: Requested, opts: PlaceOptions = {}): Promise<PlaceOrderResult | null> {
    if (!databaseEnabled(this.env)) return null;
    const d = eventDef('marketOrderRequested').data.parse(event.data);
    const target: SimTarget = { planetId: event.planetId, colonyId: d.colonyId, colonyIndex: d.colonyIndex };
    const accountId = await resolveMarketAccountId(this.prisma, d.colonyId, d.playerId ?? null, event.planetId, d.colonyIndex);
    const result = await withTransaction(this.prisma, (tx) => this.place(tx, event.planetId, d, accountId, opts.actorKind));
    await this.books.sync(result.order.orderId);
    if (opts.answerSim !== false) this.answerSim(target, result);
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

  private async matchAndHand(orderId: string): Promise<void> {
    try {
      const outcome = await this.matcher.matchOrder(orderId);
      if (outcome.fills.length > 0) await this.fills.onFills(outcome);
    } catch (err) {
      this.log.warn(`matching ${orderId} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async place(tx: TransactionClient, planetId: string, d: Requested['data'], accountId: string, actorKind?: ActorKind): Promise<PlaceOrderResult> {
    const cfg = this.policy.current();
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`market-funds:${accountId}`}, 0))`;
    const claimed = (await tx.nearColonyAccount.findUnique({ where: { accountId }, select: { claimedAt: true } }))?.claimedAt != null;
    const maxStall = d.maxStallFeeBp ?? cfg.stallFeeMaxBp;
    const { order, created } = await this.repo.createFromRequest({
      orderId: orderIdOfRef(d.ref), ref: d.ref, planetId, pair: pairId(d.resource, d.price.token), base: d.resource, quote: d.price.token,
      side: d.side, colonyId: d.colonyId, colonyIndex: d.colonyIndex, playerId: d.playerId ?? null, accountId,
      stallColonyId: d.colonyId, stallAccountId: accountId, stallHubEntityId: d.hubEntityId, platformAccountId: PLATFORM_ACCOUNT_ID,
      amount: BigInt(d.amount), priceAmount: BigInt(d.price.amount), fillPolicy: claimed ? 'all_or_nothing' : 'partial',
      policyVersion: cfg.policyVersion, policyHash: cfg.policyHash, platformFeeBp: cfg.platformFeeBp, stallFeeBp: d.stallFeeBp,
      maxStallFeeBp: d.side === 'buy' ? maxStall : null, ttlS: d.ttlS, expiresAt: new Date(Date.now() + d.ttlS * 1000),
      ...(actorKind ? { actorKind } : {}),
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
    const depositChain = await this.enqueueDeposit(tx, reserved, accountId, need, view.verifier, view.reserved, view.cargo);
    return { order: reserved, created, depositChain };
  }

  private async reject(tx: TransactionClient, order: MarketOrderRecord, code: RejectCode, detail: string): Promise<PlaceOrderResult> {
    const rejected = await this.repo.setState(order.orderId, 'REJECTED', `${code}: ${detail}`, tx);
    return { order: rejected, created: true, rejected: { code, detail }, depositChain: 0n };
  }

  /** Moves the part of the lock still in the cargo account to the verifier; the verifier's free balance is used first. */
  private async enqueueDeposit(
    tx: TransactionClient, order: MarketOrderRecord, accountId: string, need: Requirement,
    verifier: bigint, reservedByOthers: bigint, cargo: bigint,
  ): Promise<bigint> {
    if (!isResourceToken(need.token)) return 0n;
    const verifierFree = verifier > reservedByOthers ? verifier - reservedByOthers : 0n;
    const shortfall = need.principal + need.fees - verifierFree;
    const units = shortfall <= 0n ? 0n : shortfall < cargo ? shortfall : cargo;
    if (units === 0n) return 0n;
    const chain = OrderFunds.chainUnits(need.token, units);
    await this.outbox.enqueue({
      opId: marketDepositOpId(order.ref), port: 'Intents', method: 'deposit',
      payload: { accountId, tokenId: marketToken(need.token).verifierId, amount: chain.toString(), orderRef: order.ref, orderId: order.orderId },
    }, tx);
    return chain;
  }
}

/** Whole-unit in-orbit resource reservations the sim mirrors: a sell locks base, a barter buy locks the quote resource. */
export function simDeltas(o: MarketOrderRecord): Partial<Record<ResourceKey, number>> {
  const token = o.side === 'sell' ? o.base : o.quote;
  if (!isResourceToken(token as never)) return {};
  return { [token]: Number(o.reservedPrincipal + o.reservedFees) } as Partial<Record<ResourceKey, number>>;
}
