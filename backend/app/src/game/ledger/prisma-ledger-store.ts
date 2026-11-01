import type { PrismaClient } from '@terra/db';
import type { Leg } from '@terra/ledger';
import { LedgerStorePort, type LedgerCursor, type LedgerRow, type StoredLedgerRow } from './ledger-store.port';

/** Rows per `createMany` statement (Postgres caps bind parameters at 65535; 7 columns per row). */
const INSERT_CHUNK = 2000;

interface DbRow {
  tick: bigint;
  idx: number;
  reason: string;
  actor: string;
  ref: string | null;
  legs: unknown;
}

function fromDb(r: DbRow): LedgerRow {
  const legs = (r.legs as Leg[]).map((l) => ({ account: l.account, asset: l.asset, delta: Number(l.delta) }));
  return { tick: Number(r.tick), idx: r.idx, reason: r.reason, actor: r.actor, ...(r.ref === null ? {} : { ref: r.ref }), legs };
}

/** `world.ledger_entry` through Prisma (main thread only; the sim threads never touch the database). */
export class PrismaLedgerStore extends LedgerStorePort {
  constructor(private readonly prisma: PrismaClient) {
    super();
  }

  async append(planetId: string, rows: readonly LedgerRow[]): Promise<number> {
    let inserted = 0;
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      const data = rows.slice(i, i + INSERT_CHUNK).map((r) => ({
        planetId, tick: BigInt(r.tick), idx: r.idx, reason: r.reason, actor: r.actor, ref: r.ref ?? null,
        legs: r.legs.map((l) => ({ account: l.account, asset: l.asset, delta: l.delta })),
      }));
      inserted += (await this.prisma.ledgerEntry.createMany({ data, skipDuplicates: true })).count;
    }
    return inserted;
  }

  async deleteAfter(planetId: string, tick: number): Promise<number> {
    return (await this.prisma.ledgerEntry.deleteMany({ where: { planetId, tick: { gt: BigInt(tick) } } })).count;
  }

  async deleteAll(planetId: string): Promise<number> {
    return (await this.prisma.ledgerEntry.deleteMany({ where: { planetId } })).count;
  }

  async page(planetId: string, q: { throughTick: number; after?: LedgerCursor; limit: number }): Promise<LedgerRow[]> {
    const c = q.after;
    const rows = await this.prisma.ledgerEntry.findMany({
      where: {
        planetId,
        tick: { lte: BigInt(q.throughTick) },
        ...(c ? { OR: [{ tick: { gt: BigInt(c.tick) } }, { tick: BigInt(c.tick), idx: { gt: c.idx } }] } : {}),
      },
      orderBy: [{ tick: 'asc' }, { idx: 'asc' }],
      take: q.limit,
      select: { tick: true, idx: true, reason: true, actor: true, ref: true, legs: true },
    });
    return rows.map(fromDb);
  }

  async recent(planetId: string, q: { account: string; limit: number }): Promise<StoredLedgerRow[]> {
    const rows = await this.prisma.$queryRaw<(DbRow & { seq: bigint })[]>`
      SELECT tick, idx, reason, actor, ref, legs, seq FROM (
        SELECT tick, idx, reason, actor, ref, legs, ROW_NUMBER() OVER (ORDER BY tick, idx) AS seq
        FROM world.ledger_entry WHERE planet_id = ${planetId}
      ) j
      WHERE legs @> jsonb_build_array(jsonb_build_object('account', ${q.account}::text))
      ORDER BY tick DESC, idx DESC LIMIT ${q.limit}`;
    return rows.reverse().map((r) => ({ ...fromDb(r), seq: Number(r.seq) }));
  }
}
