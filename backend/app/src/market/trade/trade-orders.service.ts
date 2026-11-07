import { Inject, Injectable } from '@nestjs/common';
import {
  pairId, type CancelTradeOrderResponse, type PlaceTradeOrderRequest, type PlaceTradeOrderResponse, type SimCommandV1, type TradeAllowance,
} from '@terra/contracts';
import { withTransaction, type PrismaClient } from '@terra/db';
import { CommandPrechecks } from '../../core/command-prechecks.js';
import { FlagsService } from '../../flags/flags.service.js';
import { PRISMA } from '../../db/db.module.js';
import type { MarketColony } from '../orders/market-colonies.js';
import { PriceBoardService } from '../board/price-board.service.js';
import { checkAllowance, type ReferencePrice } from './allowance.js';
import { TradeAuth, type TradePrincipal } from './trade-auth.js';
import { TradeError } from './trade-error.js';
import { bodyHashOf, TradeRequestRepository, type RequestRow } from './trade-request.repository.js';
import { TradeSimPort } from './trade-sim.port.js';
import { tradeOrderView } from './trade-views.js';

export interface HttpResult<T> { readonly status: number; readonly body: T }

const IDEM_RE = /^[A-Za-z0-9._:~-]{1,80}$/;
const TERMINAL = new Set(['MATCHED', 'FILLED', 'CANCELLED', 'EXPIRED', 'REJECTED']);
const OUTCOME_WAIT_MS = 4000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Accepts the sim's reject codes and the host's `thread_down` as one stable code. */
const simCode = (code: string): string => (code === 'thread_down' ? 'host_unavailable' : code);

/**
 * Place and cancel for humans and bots, through the same path as the game client: write the idempotency/allowance row, run the
 * registered `market.placeOrder` precheck (the hardened one), submit the sim command (`source: 'bot'` for keys), then wait for
 * `PlaceOrderService` (which reserves, pins the policy and matches) to report the order. No route calls the matcher or the
 * reservation code directly.
 */
@Injectable()
export class TradeOrdersService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly requests: TradeRequestRepository,
    private readonly prechecks: CommandPrechecks,
    private readonly sim: TradeSimPort,
    private readonly board: PriceBoardService,
    @Inject(FlagsService) private readonly flags: FlagsService,
  ) {}

  /** Test seam. */
  now: () => number = () => Date.now();

  gate(): void {
    if (!this.flags.has('W13')) throw new TradeError('wave_disabled', 'Markets are off', undefined, 403);
  }

  /** The planet a call is about: a key's own, a session's from the request; a mismatch is `wrong_planet`. */
  planetOf(p: TradePrincipal, given: string | undefined): string {
    const own = p.key?.planetId;
    if (own && given && given !== own) throw new TradeError('wrong_planet', `This key trades on ${own}.`, { planetId: own });
    const planetId = own ?? given;
    if (!planetId) throw new TradeError('invalid_request', 'planetId is required.');
    return planetId;
  }

  async colonyOrThrow(p: TradePrincipal, planetId: string): Promise<MarketColony> {
    const colony = await p.colonyFor(planetId);
    if (!colony) throw new TradeError('no_colony', `No colony on ${planetId}.`, { planetId });
    return colony;
  }

  async place(p: TradePrincipal, body: PlaceTradeOrderRequest, idemKey: string | undefined): Promise<HttpResult<PlaceTradeOrderResponse>> {
    this.gate();
    TradeAuth.require(p, 'trade');
    const key = this.idemOf(idemKey, true)!;
    const planetId = this.planetOf(p, body.planetId);
    const colony = await this.colonyOrThrow(p, planetId);
    const pair = pairId(body.resource, body.price.token);
    const hash = bodyHashOf({ ...body, planetId });
    const reference = await this.reference(planetId, pair);
    const row = await withTransaction(this.prisma, async (tx) => {
      await this.requests.lockOwner(tx, p.ownerRef);
      const prior = await this.requests.findByIdem(p.ownerRef, key, tx);
      if (prior) return this.replay(prior, hash);
      const base = {
        ownerRef: p.ownerRef, keyId: p.key?.keyId ?? null, idemKey: key, bodyHash: hash, kind: 'place' as const, planetId, colonyId: colony.colonyId,
        colonyIndex: colony.colonyIndex, ownerId: p.ownerId, pair, side: body.side, resource: body.resource, amount: BigInt(body.amount), priceAmount: BigInt(body.price.amount),
      };
      const rejection = p.key ? await this.allowanceRejection(p, colony, { pair, amount: BigInt(body.amount), notional: BigInt(body.price.amount) }, reference, tx) : null;
      if (rejection) return { row: await this.requests.insert(tx, { ...base, state: 'REJECTED', errorCode: rejection.code, errorDetail: rejection.message }), fresh: false };
      return { row: await this.requests.insert(tx, { ...base, notional: BigInt(body.price.amount) }), fresh: true };
    });
    const settled = row.fresh ? await this.submitPlace(p, row.row, colony, body) : await this.settle(row.row);
    return this.renderPlace(settled);
  }

  private idemOf(idemKey: string | undefined, required: boolean): string | undefined {
    if (idemKey === undefined || idemKey === '') {
      if (required) throw new TradeError('idempotency_key_required', 'Send an Idempotency-Key header (1..80 chars: letters, digits, . _ : ~ -).');
      return undefined;
    }
    if (!IDEM_RE.test(idemKey)) throw new TradeError('invalid_request', 'Idempotency-Key must be 1..80 chars of letters, digits, . _ : ~ -.');
    return idemKey;
  }

  private replay(prior: RequestRow, hash: string): { row: RequestRow; fresh: false } {
    if (prior.bodyHash !== hash) throw new TradeError('idempotency_key_reuse', 'This Idempotency-Key was used with a different request.');
    return { row: prior, fresh: false };
  }

  private async allowanceRejection(
    p: TradePrincipal, colony: MarketColony, order: { pair: string; amount: bigint; notional: bigint }, reference: ReferencePrice | null, tx: Parameters<TradeRequestRepository['usage']>[2],
  ) {
    const allowance: TradeAllowance = p.key!.allowance;
    const use = await this.requests.usage(p.key!.keyId, colony.colonyId, tx, this.now());
    return checkAllowance(allowance, order, { ...use, reference });
  }

  /** Organic reference price of a pair on a planet: the board's VWAP when there is one. */
  async reference(planetId: string, pair: string): Promise<ReferencePrice | null> {
    const v = (await this.board.board(planetId)).find((r) => r.pair === pair)?.vwap;
    return v ? { num: BigInt(v.num), den: BigInt(v.den) } : null;
  }

  private async submitPlace(p: TradePrincipal, row: RequestRow, colony: MarketColony, body: PlaceTradeOrderRequest): Promise<RequestRow> {
    const args = { side: body.side, resource: body.resource, amount: body.amount, price: body.price, ttlS: body.ttlS, ...(body.maxStallFeeBp === undefined ? {} : { maxStallFeeBp: body.maxStallFeeBp }) };
    const pre = await this.prechecks.run({ kind: 'market.placeOrder', args, playerId: p.ownerId, planetId: row.planetId, colony: { id: colony.colonyId, colonyIndex: colony.colonyIndex }, dev: false });
    if (pre) return this.finish(row.requestId, 'REJECTED', { errorCode: pre.code, errorDetail: pre.detail ?? pre.code });
    await this.requests.setState(row.requestId, 'SUBMITTED', { commandId: row.requestId });
    const out = await this.submitSim(p, row, 'market.placeOrder', args);
    if (!out.ok) return this.finish(row.requestId, 'REJECTED', { errorCode: out.code, errorDetail: out.detail ?? out.code });
    return this.awaitOutcome(row.requestId);
  }

  private async submitSim(p: TradePrincipal, row: RequestRow, kind: 'market.placeOrder' | 'market.cancelOrder', args: unknown): Promise<{ ok: true } | { ok: false; code: string; detail?: string }> {
    const cmd: SimCommandV1 = { colonyIndex: row.colonyIndex, source: p.actorKind === 'bot' ? 'bot' : 'player', commandId: row.requestId, kind, args };
    try {
      const out = await this.sim.submit(row.planetId, cmd);
      return out.ok ? { ok: true } : { ok: false, code: simCode(out.code), ...('detail' in out && out.detail ? { detail: String(out.detail) } : {}) };
    } catch (err) {
      return { ok: false, code: 'host_unavailable', detail: err instanceof Error ? err.message : String(err) };
    }
  }

  private async finish(requestId: string, state: 'REJECTED' | 'FAILED', extra: { errorCode: string; errorDetail: string }): Promise<RequestRow> {
    await this.requests.setState(requestId, state, extra);
    return (await this.requests.get(requestId))!;
  }

  /** Polls the request row until `PlaceOrderService` settled it (ACCEPTED / REJECTED / FAILED) or the wait is over. */
  private async awaitOutcome(requestId: string, waitMs = OUTCOME_WAIT_MS): Promise<RequestRow> {
    const until = Date.now() + waitMs;
    for (;;) {
      const row = (await this.requests.get(requestId))!;
      if (!['SUBMITTED', 'LINKED'].includes(row.state) || Date.now() >= until) return row;
      await sleep(40);
    }
  }

  /** A replayed request that is still in flight waits briefly for its outcome; a settled one is returned as stored. */
  private settle(row: RequestRow): Promise<RequestRow> {
    return ['SUBMITTED', 'LINKED'].includes(row.state) ? this.awaitOutcome(row.requestId, 1500) : Promise.resolve(row);
  }

  private async renderPlace(row: RequestRow): Promise<HttpResult<PlaceTradeOrderResponse>> {
    const order = row.orderId ? await this.prisma.marketOrder.findUnique({ where: { orderId: row.orderId } }) : null;
    const view = order ? { order: tradeOrderView(order) } : {};
    if (row.state === 'ACCEPTED') return { status: 201, body: { requestId: row.requestId, status: 'accepted', ...view } };
    if (row.state === 'PENDING' || row.state === 'SUBMITTED' || row.state === 'LINKED') return { status: 202, body: { requestId: row.requestId, status: 'pending' } };
    const code = row.errorCode ?? 'internal';
    return { status: 422, body: { requestId: row.requestId, status: 'rejected', ...view, error: { code, message: row.errorDetail ?? code } } };
  }

  async cancel(p: TradePrincipal, idOrRef: string, idemKey: string | undefined): Promise<HttpResult<CancelTradeOrderResponse>> {
    this.gate();
    TradeAuth.require(p, 'trade');
    const key = this.idemOf(idemKey, false);
    const order = await this.prisma.marketOrder.findFirst({ where: { OR: [{ orderId: idOrRef }, { ref: idOrRef }] } });
    const colony = order ? await p.colonyFor(order.planetId) : null;
    if (!order || !colony || colony.colonyId !== order.colonyId) throw new TradeError('order_not_found', 'No such order of yours.');
    const row = await this.cancelRow(p, order, colony, key ?? `cancel:${order.orderId}`);
    if (row.fresh && !TERMINAL.has(order.state)) {
      const out = await this.submitSim(p, row.row, 'market.cancelOrder', { orderId: order.orderId });
      if (!out.ok) await this.requests.setState(row.row.requestId, 'REJECTED', { errorCode: out.code, errorDetail: out.detail ?? out.code });
    }
    return this.renderCancel(row.row.requestId, order.orderId);
  }

  private async cancelRow(p: TradePrincipal, order: NonNullable<Awaited<ReturnType<PrismaClient['marketOrder']['findFirst']>>>, colony: MarketColony, key: string): Promise<{ row: RequestRow; fresh: boolean }> {
    const hash = bodyHashOf({ cancel: order.orderId });
    return withTransaction(this.prisma, async (tx) => {
      await this.requests.lockOwner(tx, p.ownerRef);
      const prior = await this.requests.findByIdem(p.ownerRef, key, tx);
      if (prior) return this.replay(prior, hash);
      const row = await this.requests.insert(tx, {
        ownerRef: p.ownerRef, keyId: p.key?.keyId ?? null, idemKey: key, bodyHash: hash, kind: 'cancel', planetId: order.planetId, colonyId: colony.colonyId,
        colonyIndex: colony.colonyIndex, ownerId: p.ownerId, targetOrderId: order.orderId, state: 'SUBMITTED',
      });
      return { row, fresh: true };
    });
  }

  private async renderCancel(requestId: string, orderId: string): Promise<HttpResult<CancelTradeOrderResponse>> {
    const until = Date.now() + 3000;
    let order = await this.prisma.marketOrder.findUnique({ where: { orderId } });
    const req = async () => (await this.requests.get(requestId))!;
    while (order && !TERMINAL.has(order.state) && (await req()).state !== 'REJECTED' && Date.now() < until) {
      await sleep(40);
      order = await this.prisma.marketOrder.findUnique({ where: { orderId } });
    }
    const view = order ? { order: tradeOrderView(order) } : {};
    const row = await req();
    if (order?.state === 'CANCELLED') return { status: 200, body: { requestId, status: 'cancelled', ...view } };
    if (row.state === 'REJECTED') return { status: 422, body: { requestId, status: 'rejected', ...view, error: { code: row.errorCode ?? 'internal', message: row.errorDetail ?? 'rejected' } } };
    if (order && TERMINAL.has(order.state)) return { status: 409, body: { requestId, status: 'rejected', ...view, error: { code: 'order_not_open', message: `The order is ${order.state}.` } } };
    return { status: 202, body: { requestId, status: 'pending', ...view } };
  }
}
