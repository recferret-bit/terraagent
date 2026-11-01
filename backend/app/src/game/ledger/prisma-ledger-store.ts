import type { PrismaClient } from '@terra/db';
import type { Leg } from '@terra/ledger';
import { sheetOf } from './ledger-book';
import { LedgerStorePort, type LedgerRow, type LedgerTotals, type StoredLedgerRow } from './ledger-store.port';

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

  /**
   * One aggregate over `jsonb_array_elements(legs)`: Σ delta per (account, asset) of the rows with `tick ≤ T`, plus
   * their count. `SUM(bigint)` is `numeric` in Postgres: cast back to `bigint` (Prisma → JS bigint). The count comes on
   * every result row (a planet without rows still returns one row, with null cells).
   */
  async balancesThrough(planetId: string, tick: number): Promise<LedgerTotals> {
    const rows = await this.prisma.$queryRaw<Array<{ count: bigint; account: string | null; asset: string | null; total: bigint | null }>>`
      WITH e AS (
        SELECT legs FROM world.ledger_entry WHERE planet_id = ${planetId} AND tick <= ${BigInt(tick)}
      ), s AS (
        SELECT leg->>'account' AS account, leg->>'asset' AS asset, SUM((leg->>'delta')::bigint)::bigint AS total
        FROM e CROSS JOIN LATERAL jsonb_array_elements(e.legs) AS leg
        GROUP BY 1, 2
      )
      SELECT c.count, s.account, s.asset, s.total
      FROM (SELECT COUNT(*)::bigint AS count FROM e) c LEFT JOIN s ON TRUE`;
    const cells = rows.flatMap((r) => (r.account === null || r.asset === null || r.total === null ? [] : [{ account: r.account, asset: r.asset, total: Number(r.total) }]));
    return { balances: sheetOf(cells), count: Number(rows[0]?.count ?? 0n) };
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
