import { randomBytes } from 'node:crypto';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type {
  CreateTradeKeyRequest, CreateTradeKeyResponse, KillTradeRequest, KillTradeResponse, RevokeTradeKeyResponse,
  TradeAllowanceUpdate, TradeKeyListResponse, TradeKeyView, TradeMeResponse,
} from '@terra/contracts';
import { withTransaction, type PrismaClient } from '@terra/db';
import { PRISMA } from '../../db/db.module.js';
import { MarketPolicyProvider } from '../orders/market-policy.provider.js';
import { TradeAuth, type TradePrincipal } from './trade-auth.js';
import { TradeError } from './trade-error.js';
import { keyView, TradeKeyRepository, type KeyRecord } from './trade-key.repository.js';
import { defaultAllowance, mergeAllowance, newKey } from './trade-keys.js';
import { TradeOrdersService } from './trade-orders.service.js';
import { TradeRequestRepository } from './trade-request.repository.js';
import { TradeSimPort } from './trade-sim.port.js';
import { TradeStreamService } from './trade-stream.service.js';

/** Active (not revoked) keys one owner may hold: every key brings its own rate-limit bucket and allowance. */
export const MAX_ACTIVE_KEYS_PER_OWNER = 20;

/** Key lifecycle (create, list, allowance, kill switch, revoke) for the colony owner; every mutation is by a session, except a `manage` key's own kill switch. */
@Injectable()
export class TradeKeysService implements OnModuleInit {
  constructor(
    private readonly keys: TradeKeyRepository,
    private readonly requests: TradeRequestRepository,
    private readonly policy: MarketPolicyProvider,
    private readonly orders: TradeOrdersService,
    private readonly sim: TradeSimPort,
    private readonly streams: TradeStreamService,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
  ) {}

  /** A request still PENDING at boot never reached the sim (the process died between the row and the submit): it is cancelled, so it stops counting. */
  async onModuleInit(): Promise<void> {
    await this.prisma.tradeApiRequest.updateMany({
      where: { state: 'PENDING' }, data: { state: 'CANCELLED', errorCode: 'unsubmitted', errorDetail: 'the server restarted before the order was submitted' },
    }).catch(() => undefined);
  }

  async create(p: TradePrincipal, body: CreateTradeKeyRequest): Promise<CreateTradeKeyResponse> {
    this.orders.gate();
    this.sessionOnly(p);
    const colony = await this.orders.colonyOrThrow(p, body.planetId);
    const active = await this.keys.countActive(p.ownerId);
    if (active >= MAX_ACTIVE_KEYS_PER_OWNER) throw new TradeError('key_limit', `At most ${MAX_ACTIVE_KEYS_PER_OWNER} active keys per owner; revoke one first.`, { max: MAX_ACTIVE_KEYS_PER_OWNER });
    const usdcPairs = this.policy.current().pairs.filter((x) => x.quote === 'USDC').map((x) => x.pair);
    const allowance = mergeAllowance(defaultAllowance(usdcPairs), body.allowance);
    const key = newKey();
    const rec = await this.keys.create({
      key, ownerId: p.ownerId, label: body.label, planetId: body.planetId, colonyId: colony.colonyId, colonyIndex: colony.colonyIndex, accountId: colony.accountId,
      scopes: body.scopes, ...(body.ratePerSecond ? { ratePerSecond: body.ratePerSecond } : {}), ...(body.rateBurst ? { rateBurst: body.rateBurst } : {}), allowance,
    });
    return { ...(await this.withUsage(keyView(rec))), secret: key.secret };
  }

  async list(p: TradePrincipal): Promise<TradeKeyListResponse> {
    this.sessionOnly(p);
    return { keys: await Promise.all((await this.keys.listByOwner(p.ownerId)).map((k) => this.withUsage(keyView(k)))) };
  }

  /** `GET /v1/trade/me`: caller identity, colony, allowance, daily usage and kill-switch state (W13-58). */
  async me(p: TradePrincipal, planetIdIn?: string): Promise<TradeMeResponse> {
    this.orders.gate();
    TradeAuth.require(p, 'read');
    const planetId = this.orders.planetOf(p, planetIdIn);
    const colony = await this.orders.colonyOrThrow(p, planetId);
    if (p.key) {
      const fresh = (await this.keys.find(p.key.keyId)) ?? p.key;
      const view = await this.withUsage(keyView(fresh));
      return {
        actorKind: 'bot', ownerId: p.ownerId, keyId: view.keyId, planetId, colonyId: colony.colonyId, accountId: colony.accountId,
        scopes: view.scopes, allowance: view.allowance, dailySpent: view.dailySpent ?? '0', dailyRemaining: view.dailyRemaining ?? '0',
        openOrders: view.openOrders ?? 0, killSwitch: view.allowance.killSwitch,
      };
    }
    const openOrders = await this.prisma.marketOrder.count({ where: { planetId, colonyId: colony.colonyId, state: { in: ['PENDING', 'OPEN', 'PARTIAL'] } } });
    return {
      actorKind: 'player', ownerId: p.ownerId, keyId: null, planetId, colonyId: colony.colonyId, accountId: colony.accountId,
      scopes: [...p.scopes], allowance: null, dailySpent: null, dailyRemaining: null, openOrders, killSwitch: false,
    };
  }

  /** `POST /v1/trade/kill`: emergency kill switch for a key or the caller's keys on a planet; cancels unsubmitted and resting orders once (W13-59). */
  async kill(p: TradePrincipal, body: KillTradeRequest): Promise<KillTradeResponse> {
    this.orders.gate();
    if (p.key) {
      if (body.keyId && body.keyId !== p.key.keyId) throw new TradeError('forbidden_scope', 'A key may only switch its own kill switch on.');
      if (body.planetId && body.planetId !== p.key.planetId) throw new TradeError('wrong_planet', `This key trades on ${p.key.planetId}.`, { planetId: p.key.planetId });
      await this.keys.updateAllowance(p.key.keyId, { killSwitch: true });
      const cancelledUnsubmitted = await this.requests.cancelUnsubmitted(p.key.keyId);
      const cancelRequested = await this.cancelOpen(p.key);
      setTimeout(() => void this.cancelOpen(p.key!).catch(() => undefined), 1500).unref();
      return { keyId: p.key.keyId, planetId: p.key.planetId, colonyId: p.key.colonyId, killSwitch: true, cancelledUnsubmitted, cancelRequested };
    }
    if (body.keyId) {
      const key = await this.owned(p, body.keyId);
      if (body.planetId && body.planetId !== key.planetId) throw new TradeError('wrong_planet', `This key trades on ${key.planetId}.`, { planetId: key.planetId });
      await this.keys.updateAllowance(key.keyId, { killSwitch: true });
      const cancelledUnsubmitted = await this.requests.cancelUnsubmitted(key.keyId);
      const cancelRequested = await this.cancelOpen(key);
      setTimeout(() => void this.cancelOpen(key).catch(() => undefined), 1500).unref();
      return { keyId: key.keyId, planetId: key.planetId, colonyId: key.colonyId, killSwitch: true, cancelledUnsubmitted, cancelRequested };
    }
    const planetId = this.orders.planetOf(p, body.planetId);
    const colony = await this.orders.colonyOrThrow(p, planetId);
    const keys = (await this.keys.listByOwner(p.ownerId)).filter((k) => k.planetId === planetId && !k.revokedAt);
    let cancelledUnsubmitted = 0;
    let cancelRequested = 0;
    for (const k of keys) {
      await this.keys.updateAllowance(k.keyId, { killSwitch: true });
      cancelledUnsubmitted += await this.requests.cancelUnsubmitted(k.keyId);
      cancelRequested += await this.cancelOpen(k);
    }
    return { keyId: null, planetId, colonyId: colony.colonyId, killSwitch: true, cancelledUnsubmitted, cancelRequested };
  }

  /** Owner session: any field. A key holding `manage`: only its own `killSwitch: true` (an agent may stop itself, never loosen its rails). */
  async updateAllowance(p: TradePrincipal, keyId: string, patch: TradeAllowanceUpdate): Promise<TradeKeyView> {
    const key = await this.owned(p, keyId);
    if (p.key) {
      TradeAuth.require(p, 'manage');
      if (p.key.keyId !== keyId || Object.keys(patch).some((k) => k !== 'killSwitch') || patch.killSwitch !== true) {
        throw new TradeError('forbidden_scope', 'A key may only switch its own kill switch on.');
      }
    }
    const updated = await this.keys.updateAllowance(key.keyId, patch);
    if (patch.killSwitch === true) { // W13-59: the kill switch stops the key's exposure now, not only its next order
      await this.requests.cancelUnsubmitted(key.keyId);
      await this.cancelOpen(key);
      setTimeout(() => void this.cancelOpen(key).catch(() => undefined), 1500).unref();
    }
    return this.withUsage(keyView(updated!));
  }

  /** Adds `dailySpent` / `dailyRemaining` (the committed quote the `dailyBudget` check counts, current UTC day) and `openOrders` (open + in flight). */
  private async withUsage(view: TradeKeyView): Promise<TradeKeyView> {
    const use = await withTransaction(this.prisma, (tx) => this.requests.usage(view.keyId, view.colonyId, tx, Date.now()));
    const budget = BigInt(view.allowance.dailyBudget);
    return { ...view, dailySpent: use.committedToday.toString(), dailyRemaining: (use.committedToday >= budget ? 0n : budget - use.committedToday).toString(), openOrders: use.outstandingOrders };
  }

  /** Revokes: unsubmitted requests are cancelled, resting orders get a cancel through the sim; a second sweep catches orders that were in flight. */
  async revoke(p: TradePrincipal, keyId: string): Promise<RevokeTradeKeyResponse> {
    this.sessionOnly(p); // route table: session only; a key (even read-only) must not revoke its siblings
    const key = await this.owned(p, keyId);
    await this.keys.revoke(key.keyId);
    this.streams.closeKey(key.keyId);
    const cancelledUnsubmitted = await this.requests.cancelUnsubmitted(key.keyId);
    const cancelRequested = await this.cancelOpen(key);
    setTimeout(() => void this.cancelOpen(key).catch(() => undefined), 1500).unref();
    return { keyId: key.keyId, revoked: true, cancelledUnsubmitted, cancelRequested };
  }

  private async owned(p: TradePrincipal, keyId: string): Promise<KeyRecord> {
    const key = await this.keys.find(keyId);
    if (!key || key.ownerId !== p.ownerId) throw new TradeError('key_not_found', 'No such key.');
    return key;
  }

  private sessionOnly(p: TradePrincipal): void {
    if (p.key) throw new TradeError('forbidden_scope', 'Keys are managed by the owner session, not by a key.');
  }

  private async cancelOpen(key: KeyRecord): Promise<number> {
    let sent = 0;
    for (const r of await this.requests.accepted(key.keyId)) {
      const o = await this.prisma.marketOrder.findUnique({ where: { orderId: r.orderId! }, select: { orderId: true, state: true, colonyIndex: true } });
      if (!o || !['OPEN', 'PARTIAL'].includes(o.state)) continue;
      const out = await this.sim.submit(key.planetId, {
        colonyIndex: key.colonyIndex, source: 'bot', commandId: `rv_${randomBytes(10).toString('hex')}`, kind: 'market.cancelOrder', args: { orderId: o.orderId },
      }).catch(() => null);
      if (out?.ok) sent += 1;
    }
    return sent;
  }
}
