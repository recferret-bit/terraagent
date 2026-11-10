import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type PrismaClient, withTransaction, type DbClient } from '@terra/db';
import { PRISMA } from '../../db/db.module.js';
import { GuildProvisionError } from './guild-error.js';
import {
  allocationId,
  emptyInventory,
  FIXTURE_LABEL,
  lockKey,
  SUBSIDY_LABEL,
  withCargo,
  type CargoLine,
  type GuildAllocation,
  type GuildDraft,
  type HomeRouteDoc,
  type InventoryCache,
  type StrategyDoc,
} from './guild-plan.js';

type Row = NonNullable<Awaited<ReturnType<PrismaClient['guildNpc']['findUnique']>>>;

/** `chain.guild_npc`. Creates once; a unique clash returns the row already stored (counters included). */
@Injectable()
export class GuildNpcRepository {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  find(id: string, db: DbClient = this.prisma): Promise<GuildAllocation | null> {
    return db.guildNpc.findUnique({ where: { id } }).then((row) => (row ? toAllocation(row) : null));
  }

  list(db: DbClient = this.prisma): Promise<GuildAllocation[]> {
    return db.guildNpc.findMany({ orderBy: { id: 'asc' } }).then((rows) => rows.map(toAllocation));
  }

  allocatedAtomic(db: DbClient = this.prisma): Promise<bigint> {
    return this.list(db).then((rows) => rows.reduce((sum, row) => sum + BigInt(row.quoteBudgetAtomic), 0n));
  }

  /** One NPC at a time. The lock is held while the wallet port runs, so a second boot cannot insert twice. */
  withLock<T>(npcId: string, fn: (db: DbClient) => Promise<T>): Promise<T> {
    return withTransaction(this.prisma, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey(npcId)})::bigint)`;
      return fn(tx);
    }, { timeout: 20_000, maxWait: 5_000 });
  }

  async insert(draft: GuildDraft, db: DbClient): Promise<GuildAllocation> {
    try {
      return toAllocation(await db.guildNpc.create({ data: dataOf(draft) }));
    } catch (e) {
      if (!isUnique(e)) throw e;
      const again = await db.guildNpc.findUnique({ where: { id: draft.npc.id } });
      if (again) return toAllocation(again);
      throw e;
    }
  }

  /** Replaces the carried cache. Does not touch the quote budget or the spend and loss counters. */
  async saveInventory(id: string, inventory: InventoryCache, db: DbClient = this.prisma): Promise<GuildAllocation> {
    const row = await db.guildNpc.findUnique({ where: { id } });
    if (!row) throw new GuildProvisionError('not_provisioned', `Guild NPC ${id} is not provisioned`);
    return toAllocation(await db.guildNpc.update({ where: { id }, data: { inventoryCache: json(inventory) } }));
  }

  /** Adds one fixture line. Does not touch the quote budget or the spend and loss counters. */
  async appendFixture(id: string, resource: string, amount: number): Promise<GuildAllocation> {
    const row = await this.prisma.guildNpc.findUnique({ where: { id } });
    if (!row) throw new GuildProvisionError('not_provisioned', `Guild NPC ${id} is not provisioned`);
    const next = withCargo(inventoryOf(row.inventoryCache), resource, amount);
    const updated = await this.prisma.guildNpc.update({ where: { id }, data: { inventoryCache: json(next) } });
    return toAllocation(updated);
  }
}

function dataOf(draft: GuildDraft): Prisma.GuildNpcCreateInput {
  return {
    id: draft.npc.id,
    accountId: draft.npc.accountId,
    strategy: json(draft.strategy),
    inventoryCache: json(draft.inventory),
    homeRoute: json(draft.homeRoute),
    allocationId: allocationId(draft.policyVersion, draft.npc.id),
    quoteBudgetAtomic: draft.quoteBudgetAtomic,
    spendAtomic: '0',
    lossAtomic: '0',
    cargoLabel: FIXTURE_LABEL,
    quoteLabel: SUBSIDY_LABEL,
    cashEnabled: 0,
    actorKind: 'npc',
    publicKey: draft.publicKey,
    tradeKeyId: draft.tradeKeyId,
    policyVersion: draft.policyVersion,
  };
}

function toAllocation(row: Row): GuildAllocation {
  if (row.cargoLabel !== FIXTURE_LABEL || row.quoteLabel !== SUBSIDY_LABEL || row.actorKind !== 'npc' || row.cashEnabled !== 0) {
    throw new GuildProvisionError('account_mismatch', `Guild NPC ${row.id} is not a fixture/subsidy npc row`);
  }
  return {
    npcId: row.id,
    accountId: row.accountId,
    allocationId: row.allocationId,
    quoteBudgetAtomic: row.quoteBudgetAtomic.toFixed(0),
    spendAtomic: row.spendAtomic.toFixed(0),
    lossAtomic: row.lossAtomic.toFixed(0),
    tradeKeyId: row.tradeKeyId,
    publicKey: row.publicKey,
    cargoLabel: FIXTURE_LABEL,
    quoteLabel: SUBSIDY_LABEL,
    cashEnabled: 0,
    actorKind: 'npc',
    inventory: inventoryOf(row.inventoryCache),
    policyVersion: row.policyVersion,
  };
}

function inventoryOf(value: Prisma.JsonValue): InventoryCache {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyInventory();
  const lines = (value as { lines?: unknown }).lines;
  if (!Array.isArray(lines)) return emptyInventory();
  return { label: FIXTURE_LABEL, organic: false, lines: lines.filter(isCargoLine) };
}

function isCargoLine(value: unknown): value is CargoLine {
  if (!value || typeof value !== 'object') return false;
  const row = value as CargoLine;
  return row.label === FIXTURE_LABEL && row.organic === false && row.source === 'mock-grant'
    && typeof row.resource === 'string' && typeof row.amount === 'number';
}

function json(value: StrategyDoc | InventoryCache | HomeRouteDoc): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function isUnique(e: unknown): boolean {
  return typeof e === 'object' && e !== null && 'code' in e && (e as { code: string }).code === 'P2002';
}
