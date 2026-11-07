import { Inject, Injectable } from '@nestjs/common';
import { TradeScope, type TradeAllowance, type TradeAllowanceUpdate, type TradeKeyView } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { PRISMA } from '../../db/db.module.js';
import type { NewKey } from './trade-keys.js';

export interface KeyRecord {
  readonly keyId: string;
  readonly secretHash: string;
  readonly ownerId: string;
  readonly label: string;
  readonly planetId: string;
  readonly colonyId: string;
  readonly colonyIndex: number;
  readonly accountId: string;
  readonly scopes: readonly TradeScope[];
  readonly ratePerSecond: number | null;
  readonly rateBurst: number | null;
  readonly createdAt: Date;
  readonly lastUsedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly allowance: TradeAllowance;
}

export interface NewKeyInput {
  readonly key: NewKey;
  readonly ownerId: string;
  readonly label: string;
  readonly planetId: string;
  readonly colonyId: string;
  readonly colonyIndex: number;
  readonly accountId: string;
  readonly scopes: readonly TradeScope[];
  readonly ratePerSecond?: number;
  readonly rateBurst?: number;
  readonly allowance: TradeAllowance;
}

type Row = NonNullable<Awaited<ReturnType<PrismaClient['tradeApiKey']['findUnique']>>>;
type AllowanceRow = NonNullable<Awaited<ReturnType<PrismaClient['tradeApiAllowance']['findUnique']>>>;

const allowanceOf = (a: AllowanceRow): TradeAllowance => ({
  maxOpenOrders: a.maxOpenOrders, maxOrderNotional: a.maxOrderNotional.toFixed(), dailyBudget: a.dailyBudget.toFixed(),
  allowedPairs: a.allowedPairs, priceBandBp: a.priceBandBp, killSwitch: a.killSwitch,
});

const recordOf = (r: Row, a: AllowanceRow): KeyRecord => ({
  keyId: r.keyId, secretHash: r.secretHash, ownerId: r.ownerId, label: r.label, planetId: r.planetId, colonyId: r.colonyId, colonyIndex: r.colonyIndex,
  accountId: r.accountId, scopes: r.scopes.map((s) => TradeScope.parse(s)), ratePerSecond: r.ratePerSecond, rateBurst: r.rateBurst,
  createdAt: r.createdAt, lastUsedAt: r.lastUsedAt, revokedAt: r.revokedAt, allowance: allowanceOf(a),
});

export const keyView = (k: KeyRecord): TradeKeyView => ({
  keyId: k.keyId, label: k.label, planetId: k.planetId, colonyId: k.colonyId, accountId: k.accountId, scopes: [...k.scopes],
  ratePerSecond: k.ratePerSecond, rateBurst: k.rateBurst, createdAtMs: k.createdAt.getTime(), lastUsedAtMs: k.lastUsedAt?.getTime() ?? null,
  revokedAtMs: k.revokedAt?.getTime() ?? null, allowance: k.allowance,
});

/** Persistence of API keys and their allowance rows (`chain.trade_api_key`, `chain.trade_api_allowance`); the allowance survives restarts. */
@Injectable()
export class TradeKeyRepository {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async create(i: NewKeyInput): Promise<KeyRecord> {
    const a = i.allowance;
    const [row, allowance] = await this.prisma.$transaction([
      this.prisma.tradeApiKey.create({
        data: {
          keyId: i.key.keyId, secretHash: i.key.hash, ownerId: i.ownerId, label: i.label, planetId: i.planetId, colonyId: i.colonyId,
          colonyIndex: i.colonyIndex, accountId: i.accountId, scopes: [...i.scopes], ratePerSecond: i.ratePerSecond ?? null, rateBurst: i.rateBurst ?? null,
        },
      }),
      this.prisma.tradeApiAllowance.create({
        data: { keyId: i.key.keyId, maxOpenOrders: a.maxOpenOrders, maxOrderNotional: a.maxOrderNotional, dailyBudget: a.dailyBudget, allowedPairs: a.allowedPairs, priceBandBp: a.priceBandBp, killSwitch: a.killSwitch },
      }),
    ]);
    return recordOf(row, allowance);
  }

  async find(keyId: string): Promise<KeyRecord | null> {
    const [row, allowance] = await Promise.all([this.prisma.tradeApiKey.findUnique({ where: { keyId } }), this.prisma.tradeApiAllowance.findUnique({ where: { keyId } })]);
    return row && allowance ? recordOf(row, allowance) : null;
  }

  async listByOwner(ownerId: string): Promise<KeyRecord[]> {
    const rows = await this.prisma.tradeApiKey.findMany({ where: { ownerId }, orderBy: { createdAt: 'desc' } });
    const out: KeyRecord[] = [];
    for (const r of rows) {
      const k = await this.find(r.keyId);
      if (k) out.push(k);
    }
    return out;
  }

  countActive(ownerId: string): Promise<number> {
    return this.prisma.tradeApiKey.count({ where: { ownerId, revokedAt: null } });
  }

  async updateAllowance(keyId: string, patch: TradeAllowanceUpdate): Promise<KeyRecord | null> {
    const data = {
      ...(patch.maxOpenOrders === undefined ? {} : { maxOpenOrders: patch.maxOpenOrders }),
      ...(patch.maxOrderNotional === undefined ? {} : { maxOrderNotional: patch.maxOrderNotional }),
      ...(patch.dailyBudget === undefined ? {} : { dailyBudget: patch.dailyBudget }),
      ...(patch.allowedPairs === undefined ? {} : { allowedPairs: patch.allowedPairs }),
      ...(patch.priceBandBp === undefined ? {} : { priceBandBp: patch.priceBandBp }),
      ...(patch.killSwitch === undefined ? {} : { killSwitch: patch.killSwitch }),
    };
    await this.prisma.tradeApiAllowance.updateMany({ where: { keyId }, data });
    return this.find(keyId);
  }

  /** Marks the key revoked (idempotent: the first revocation time stays). */
  async revoke(keyId: string): Promise<void> {
    await this.prisma.tradeApiKey.updateMany({ where: { keyId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async touch(keyId: string): Promise<void> {
    await this.prisma.tradeApiKey.updateMany({ where: { keyId }, data: { lastUsedAt: new Date() } });
  }
}
