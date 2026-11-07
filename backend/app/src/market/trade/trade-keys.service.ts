import { randomBytes } from 'node:crypto';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { CreateTradeKeyRequest, CreateTradeKeyResponse, RevokeTradeKeyResponse, TradeAllowanceUpdate, TradeKeyListResponse, TradeKeyView } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { PRISMA } from '../../db/db.module.js';
import { MarketPolicyProvider } from '../orders/market-policy.provider.js';
import { TradeAuth, type TradePrincipal } from './trade-auth.js';
import { TradeError } from './trade-error.js';
import { keyView, TradeKeyRepository, type KeyRecord } from './trade-key.repository.js';
import { defaultAllowance, mergeAllowance, newKey } from './trade-keys.js';
import { TradeOrdersService } from './trade-orders.service.js';
import { TradeRequestRepository } from './trade-request.repository.js';
import { TradeSimPort } from './trade-sim.port.js';

/** Key lifecycle (create, list, allowance, kill switch, revoke) for the colony owner; every mutation is by a session, except a `manage` key's own kill switch. */
@Injectable()
export class TradeKeysService implements OnModuleInit {
  constructor(
    private readonly keys: TradeKeyRepository,
    private readonly requests: TradeRequestRepository,
    private readonly policy: MarketPolicyProvider,
    private readonly orders: TradeOrdersService,
    private readonly sim: TradeSimPort,
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
    const usdcPairs = this.policy.current().pairs.filter((x) => x.quote === 'USDC').map((x) => x.pair);
    const allowance = mergeAllowance(defaultAllowance(usdcPairs), body.allowance);
    const key = newKey();
    const rec = await this.keys.create({
      key, ownerId: p.ownerId, label: body.label, planetId: body.planetId, colonyId: colony.colonyId, colonyIndex: colony.colonyIndex, accountId: colony.accountId,
      scopes: body.scopes, ...(body.ratePerSecond ? { ratePerSecond: body.ratePerSecond } : {}), ...(body.rateBurst ? { rateBurst: body.rateBurst } : {}), allowance,
    });
    return { ...keyView(rec), secret: key.secret };
  }

  async list(p: TradePrincipal): Promise<TradeKeyListResponse> {
    this.sessionOnly(p);
    return { keys: (await this.keys.listByOwner(p.ownerId)).map(keyView) };
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
    return keyView(updated!);
  }

  /** Revokes: unsubmitted requests are cancelled, resting orders get a cancel through the sim; a second sweep catches orders that were in flight. */
  async revoke(p: TradePrincipal, keyId: string): Promise<RevokeTradeKeyResponse> {
    const key = await this.owned(p, keyId);
    await this.keys.revoke(key.keyId);
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
