import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type PrismaClient, withTransaction, type DbClient } from '@terra/db';
import { PRISMA } from '../../../db/db.module.js';
import { GuildProvisionError } from '../guild-error.js';
import {
  bookOf,
  consumeExposure,
  releaseExposure,
  reserveExposure,
  type ExposureBook,
  type ExposureSide,
  type FundingBucket,
  type FundingPair,
  type ReserveResult,
  type StoredBook,
} from './exposure.js';

/** One guild-wide row. Npc rows use the npc id as `scope`. */
export const GLOBAL_SCOPE = 'global';

type FundingRow = NonNullable<Awaited<ReturnType<PrismaClient['guildFunding']['findUnique']>>>;

/**
 * `chain.guild_funding`. Reserves take one advisory lock on the global book, then the npc, so two
 * concurrent holds cannot both pass a cap. Caps move in `topUp` or the one-time seed.
 */
@Injectable()
export class GuildFundingRepository {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  view(npcId: string, inventoryCap: bigint): Promise<FundingPair> {
    return this.locked(npcId, inventoryCap, async (_tx, snap) => snap);
  }

  reserve(npcId: string, inventoryCap: bigint, bucket: FundingBucket, amount: bigint): Promise<ReserveResult> {
    return this.locked(npcId, inventoryCap, async (tx, snap) => {
      const book = bookOf(snap, bucket);
      if (snap.npc.killed) return { ok: false, reason: 'killed', book };
      const next = reserveExposure(book, amount);
      if (next.ok) await this.write(tx, npcId, bucket, next.book);
      return next;
    });
  }

  release(npcId: string, inventoryCap: bigint, bucket: FundingBucket, amount: bigint): Promise<ExposureBook> {
    return this.locked(npcId, inventoryCap, async (tx, snap) => {
      const book = releaseExposure(bookOf(snap, bucket), amount);
      await this.write(tx, npcId, bucket, book);
      return book;
    });
  }

  consume(npcId: string, inventoryCap: bigint, bucket: FundingBucket, amount: bigint): Promise<ExposureBook> {
    return this.locked(npcId, inventoryCap, async (tx, snap) => {
      const book = consumeExposure(bookOf(snap, bucket), amount);
      await this.write(tx, npcId, bucket, book);
      return book;
    });
  }

  markKilled(npcId: string, inventoryCap: bigint): Promise<void> {
    return this.locked(npcId, inventoryCap, async (tx) => {
      await tx.guildFunding.update({ where: { scope: npcId }, data: { killed: true } });
    });
  }

  /** Adds `amount` to this allocation's cash cap and the global cash cap. Does not touch the chain key. */
  async topUp(
    allocationId: string,
    amount: bigint,
    inventoryCap: bigint,
  ): Promise<{ cashCapAtomic: string; globalCashCapAtomic: string }> {
    if (amount <= 0n) throw new GuildProvisionError('bad_amount', 'Top-up amount must be a positive atomic integer');
    const npc = await this.prisma.guildNpc.findUnique({ where: { allocationId } });
    if (!npc) throw new GuildProvisionError('not_provisioned', `No Guild allocation ${allocationId}`);
    return this.locked(npc.id, inventoryCap, async (tx, snap) => {
      const cashCapAtomic = (snap.npc.cash.cap + amount).toString();
      const globalCashCapAtomic = (snap.global.cash.cap + amount).toString();
      await tx.guildFunding.update({ where: { scope: npc.id }, data: { cashCapAtomic } });
      await tx.guildFunding.update({ where: { scope: GLOBAL_SCOPE }, data: { cashCapAtomic: globalCashCapAtomic } });
      const fresh = await tx.guildNpc.findUniqueOrThrow({ where: { id: npc.id } });
      const quote = (dec(fresh.quoteBudgetAtomic) + amount).toString();
      await tx.guildNpc.update({ where: { id: npc.id }, data: { quoteBudgetAtomic: quote } });
      return { cashCapAtomic, globalCashCapAtomic };
    });
  }

  private locked<T>(
    npcId: string,
    inventoryCap: bigint,
    fn: (tx: DbClient, snap: FundingPair) => Promise<T>,
  ): Promise<T> {
    return withTransaction(
      this.prisma,
      async (tx) => {
        await lockBook(tx, npcId);
        await this.ensure(tx, npcId, inventoryCap);
        return fn(tx, await this.load(tx, npcId));
      },
      { timeout: 20_000, maxWait: 5_000 },
    );
  }

  private async ensure(tx: DbClient, npcId: string, inventoryCap: bigint): Promise<void> {
    const npc = await tx.guildNpc.findUnique({ where: { id: npcId } });
    if (!npc) throw new GuildProvisionError('not_provisioned', `Guild NPC ${npcId} is not provisioned`);
    if (await tx.guildFunding.findUnique({ where: { scope: npcId } })) {
      await this.ensureGlobal(tx);
      return;
    }
    await this.ensureGlobal(tx);
    const cashCap = dec(npc.quoteBudgetAtomic);
    await tx.guildFunding.create({ data: npcSeed(npcId, npc.allocationId, cashCap, inventoryCap) });
    await this.addGlobal(tx, cashCap, inventoryCap);
  }

  /** Creates the global row from npc rows already stored. A second call leaves it alone. */
  private async ensureGlobal(tx: DbClient): Promise<void> {
    if (await tx.guildFunding.findUnique({ where: { scope: GLOBAL_SCOPE } })) return;
    const rows = await tx.guildFunding.findMany({ where: { kind: 'npc' } });
    const cash = rows.reduce((sum, row) => sum + dec(row.cashCapAtomic), 0n);
    const inventory = rows.reduce((sum, row) => sum + dec(row.inventoryCapUnits), 0n);
    await tx.guildFunding.create({ data: globalSeed(cash, inventory) });
  }

  private async addGlobal(tx: DbClient, cash: bigint, inventory: bigint): Promise<void> {
    const global = await tx.guildFunding.findUniqueOrThrow({ where: { scope: GLOBAL_SCOPE } });
    await tx.guildFunding.update({
      where: { scope: GLOBAL_SCOPE },
      data: {
        cashCapAtomic: (dec(global.cashCapAtomic) + cash).toString(),
        inventoryCapUnits: (dec(global.inventoryCapUnits) + inventory).toString(),
      },
    });
  }

  private async load(tx: DbClient, npcId: string): Promise<FundingPair> {
    const npc = await tx.guildFunding.findUnique({ where: { scope: npcId } });
    const global = await tx.guildFunding.findUnique({ where: { scope: GLOBAL_SCOPE } });
    if (!npc || !global) throw new GuildProvisionError('not_provisioned', `Guild funding for ${npcId} is missing`);
    return { npc: stored(npc), global: stored(global) };
  }

  private async write(tx: DbClient, npcId: string, bucket: FundingBucket, book: ExposureBook): Promise<void> {
    await tx.guildFunding.update({ where: { scope: npcId }, data: patch(bucket, book.npc) });
    await tx.guildFunding.update({ where: { scope: GLOBAL_SCOPE }, data: patch(bucket, book.global) });
  }
}

function lockBook(tx: DbClient, npcId: string): Promise<unknown> {
  return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('guild-funding:global')::bigint)`.then(
    () => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`guild-funding:${npcId}`})::bigint)`,
  );
}

function npcSeed(
  npcId: string,
  allocationId: string,
  cashCap: bigint,
  inventoryCap: bigint,
): Prisma.GuildFundingCreateInput {
  return {
    scope: npcId,
    kind: 'npc',
    allocationId,
    cashCapAtomic: cashCap.toString(),
    inventoryCapUnits: inventoryCap.toString(),
    killed: false,
  };
}

function globalSeed(cash: bigint, inventory: bigint): Prisma.GuildFundingCreateInput {
  return {
    scope: GLOBAL_SCOPE,
    kind: 'global',
    cashCapAtomic: cash.toString(),
    inventoryCapUnits: inventory.toString(),
    killed: false,
  };
}

function patch(bucket: FundingBucket, side: ExposureSide): Prisma.GuildFundingUpdateInput {
  const reserved = side.reserved.toString();
  const spent = side.spent.toString();
  return bucket === 'cash'
    ? { cashReservedAtomic: reserved, cashSpentAtomic: spent }
    : { inventoryReserved: reserved, inventorySpent: spent };
}

function stored(row: FundingRow): StoredBook {
  return {
    killed: row.killed,
    cash: { cap: dec(row.cashCapAtomic), reserved: dec(row.cashReservedAtomic), spent: dec(row.cashSpentAtomic) },
    inventory: {
      cap: dec(row.inventoryCapUnits),
      reserved: dec(row.inventoryReserved),
      spent: dec(row.inventorySpent),
    },
  };
}

function dec(value: { toFixed(digits: number): string }): bigint {
  return BigInt(value.toFixed(0));
}
