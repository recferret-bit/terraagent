import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { eventDef, marketDepositOpId, type ActorKind, marketToken, isResourceToken, pairId, type MarketTokenKey, type RejectCode, type ResourceKey } from '@terra/contracts';
import { withTransaction, type DbClient, type PrismaClient, type TransactionClient } from '@terra/db';
import { EventBus } from '../../bus/event-bus.js';
import type { PlanetEventOf } from '../../bus/channels.js';
import { databaseEnabled } from '../../core/persistence.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { PRISMA } from '../../db/db.module.js';
import { ChainOutboxRepository } from '../../near/application/outbox/chain-outbox.repository.js';
import { TradeRequestLinker, type OrderLink } from '../trade/trade-request-linker.js';
import { MarketBooks } from '../book/market-books.js';
import type { MarketOrderRecord } from '../book/market-order.record.js';
import { MarketOrderRepository } from '../book/market-order.repository.js';
import { DirectorMatchGuard } from '../director/director-match-guard.js';
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

/** The sim's echo of the API command id (absent until the sim emits it; read from the raw event so the contract schema need not know it). */
const commandIdOf = (data: unknown): string | undefined => {
  const id = (data as { commandId?: unknown }).commandId;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
};

/** Options of `handle`: `fixture` orders (dev seed bots, W13-30) are labelled `actorKind` fixture and never answered to the sim. */
export interface PlaceOptions {
  readonly actorKind?: ActorKind;
  readonly answerSim?: boolean;
}

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
    @Optional() private readonly linker?: TradeRequestLinker,
    @Optional() private readonly directorGuard?: DirectorMatchGuard,
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
    const parsed = eventDef('marketOrderRequested').data.parse(event.data);
    const link = opts.actorKind ? null : await this.linker?.claim(event.planetId, { ...parsed, commandId: commandIdOf(event.data) }).catch(() => null) ?? null;
    try {
      return await this.handleLinked(event, parsed, opts, link);
    } catch (err) {
      if (link) await this.linker?.fail(link, 'The order could not be processed (internal error); see the server log.').catch(() => undefined); // never the raw error: clients read this text
      throw err;
    }
  }

  private async handleLinked(event: Requested, parsed: Requested['data'], opts: PlaceOptions, link: OrderLink | null): Promise<PlaceOrderResult> {
    const d = link && !parsed.playerId ? { ...parsed, playerId: link.ownerId } : parsed; // an API order carries its owner (organic rule)
    const actorKind = opts.actorKind ?? link?.actorKind ?? parsed.actorKind;
    const target: SimTarget = { planetId: event.planetId, colonyId: d.colonyId, colonyIndex: d.colonyIndex };
    const accountId = await resolveMarketAccountId(this.prisma, d.colonyId, d.playerId ?? null, event.planetId, d.colonyIndex);
    const blocked = d.director === true ? await this.directorBlock(d) : undefined;
    const result = await withTransaction(this.prisma, (tx) => this.place(tx, event.planetId, d, accountId, actorKind, blocked));
    if (d.stallName) await this.rememberStall(event.planetId, d, accountId);
    await this.books.sync(result.order.orderId);
    if (opts.answerSim !== false) this.answerSim(target, result);
    if (result.created && !result.rejected) await this.matchAndSettle(result.order.orderId);
    // after matching, so the API caller's response already shows the fills of the order it placed
    if (link) await this.linker?.complete(link, { orderId: result.order.orderId, ...(result.rejected ? { rejected: result.rejected } : {}) });
    return result;
  }

  /** The stall's display name (the colony's) for the contract toast; the fee column keeps the policy default until `market.setHubFee` is persisted. */
  private async rememberStall(planetId: string, d: Requested['data'], accountId: string): Promise<void> {
    await this.prisma.marketStall.upsert({
      where: { planetId_colonyId: { planetId, colonyId: d.colonyId } },
      create: { planetId, colonyId: d.colonyId, colonyIndex: d.colonyIndex, hubEntityId: d.hubEntityId, accountId, name: d.stallName ?? null, feeBp: d.stallFeeBp },
      update: { name: d.stallName ?? null },
    }).catch((err: unknown) => this.log.warn(`stall name not stored: ${err instanceof Error ? err.message : String(err)}`));
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
  async matchAndSettle(orderId: string): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        const touched = await withTransaction(this.prisma, async (tx) => {
          const outcome = await this.matcher.matchOrder(orderId, tx);
          return outcome.fills.length > 0 ? this.fills.onFills(outcome, tx) : [];
        });
        if (touched.length > 0) await this.books.sync(...touched);
        return;
      } catch (err) {
        // A lock conflict with another writer (deadlock 40P01 / serialization 40001) rolled the whole match back: the order still rests, try again.
        if (attempt < 8 && /40P01|40001|deadlock detected/.test(String((err as { code?: string; message?: string }).code ?? '') + String((err as Error).message ?? ''))) {
          await new Promise((r) => setTimeout(r, 10 + Math.random() * 40 * attempt));
          continue;
        }
        this.log.warn(`matching ${orderId} failed: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
    }
  }

  /** Director flag with no guard, or a guard refusal, is `autotrade_limit`. Player orders never call this. */
  private directorBlock(d: Requested['data']): Promise<'autotrade_limit' | undefined> {
    if (!this.directorGuard) return Promise.resolve('autotrade_limit');
    return this.directorGuard.block({ colonyId: d.colonyId, resource: d.resource, amount: d.amount, side: d.side });
  }

  private async place(
    tx: TransactionClient,
    planetId: string,
    d: Requested['data'],
    accountId: string,
    actorKind?: ActorKind,
    blocked?: 'autotrade_limit',
  ): Promise<PlaceOrderResult> {
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
      ...(actorKind ? { actorKind } : {}),
    }, tx);
    if (!created) return { order, created, depositChain: 0n };
    if (blocked) return this.reject(tx, order, blocked, 'That trade is outside the autoTrade limits.');

    await this.repo.lockForUpdate((await this.repo.listOpenByColony(planetId, d.colonyId, tx)).map((o) => o.orderId), tx);
    const open = (await this.repo.listOpenByColony(planetId, d.colonyId, tx)).length;
    if (open >= cfg.openOrderLimit) return this.reject(tx, order, 'order_limit', `At most ${cfg.openOrderLimit} open orders.`);
    const need = requirementOf({
      side: d.side, base: d.resource, quote: d.price.token, amount: BigInt(d.amount), priceAmount: BigInt(d.price.amount),
      platformFeeBp: cfg.platformFeeBp, maxStallFeeBp: maxStall,
    });
    const view = await this.funds.view(accountId, need.token, tx);
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
