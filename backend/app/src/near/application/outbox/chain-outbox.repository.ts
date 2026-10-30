import { Inject, Injectable } from '@nestjs/common';
import { RepositoryBase, type DbClient, type PrismaClient } from '@terra/db';
import { PRISMA } from '../../../db/db.module.js';
import type { NearPortName } from '../../domain/types.js';
import { MAX_OP_ID_LENGTH } from './op-id.js';

export interface OutboxEntry {
  readonly opId: string;
  readonly port: NearPortName;
  readonly method: string;
  readonly payload: object;
}

export interface ClaimedRow {
  readonly id: bigint;
  readonly opId: string;
  readonly port: string;
  readonly method: string;
  readonly payload: Record<string, unknown>;
  /** Attempt number of this claim (1 for the first call). Fences the result write. */
  readonly attempts: number;
}

export type OutboxRow = NonNullable<Awaited<ReturnType<PrismaClient['chainOutbox']['findUnique']>>>;

const ID_RE = /^[a-z][a-z0-9-]*(:[^:\s]+)+$/;

/** Persistence of the chain outbox (NEAR §1a rule 6). Writers call `enqueue` inside the transaction of their game change. */
@Injectable()
export class ChainOutboxRepository extends RepositoryBase {
  constructor(@Inject(PRISMA) prisma: PrismaClient) {
    super(prisma);
  }

  /**
   * Insert-or-ignore on `opId`: a second enqueue of the same id is a no-op and returns the existing row (never two rows).
   * Pass the caller's `tx` so the row commits or rolls back together with the game change.
   */
  async enqueue(entry: OutboxEntry, tx?: DbClient): Promise<OutboxRow> {
    if (!ID_RE.test(entry.opId)) throw new Error(`opId must look like kind:part[:part...] (use opId()), got "${entry.opId}"`);
    if (entry.opId.length > MAX_OP_ID_LENGTH) throw new Error(`opId longer than ${MAX_OP_ID_LENGTH} characters: ${entry.opId}`);
    const db = this.db(tx);
    await db.chainOutbox.createMany({
      data: [{ opId: entry.opId, port: entry.port, method: entry.method, payload: entry.payload }],
      skipDuplicates: true,
    });
    return db.chainOutbox.findUniqueOrThrow({ where: { opId: entry.opId } });
  }

  find(opId: string, tx?: DbClient): Promise<OutboxRow | null> {
    return this.db(tx).chainOutbox.findUnique({ where: { opId } });
  }

  /**
   * Atomically claims up to `limit` due rows (PENDING/FAILED with `nextAttemptAt <= now`, plus RUNNING rows whose lease expired because
   * their relay died). Every claim counts as an attempt. Uses `FOR UPDATE SKIP LOCKED`, so concurrent relays never take the same row.
   */
  async claimDue(limit: number, leaseMs: number): Promise<ClaimedRow[]> {
    const rows = await this.prisma.$queryRaw<(ClaimedRow & { nextAttemptAt: Date })[]>`
      UPDATE chain.chain_outbox o
         SET status = 'RUNNING'::chain.outbox_status, attempts = o.attempts + 1,
             locked_until = now() + make_interval(secs => ${leaseMs / 1000}), updated_at = now()
       WHERE o.id IN (
         SELECT id FROM chain.chain_outbox
          WHERE (status IN ('PENDING'::chain.outbox_status, 'FAILED'::chain.outbox_status) AND next_attempt_at <= now())
             OR (status = 'RUNNING'::chain.outbox_status AND locked_until < now())
          ORDER BY next_attempt_at, id
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED)
      RETURNING o.id, o.op_id AS "opId", o.port, o.method, o.payload, o.attempts, o.next_attempt_at AS "nextAttemptAt"`;
    // RETURNING order is unspecified: hand rows back oldest-due first.
    return rows.sort((a, b) => a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime() || (a.id < b.id ? -1 : 1));
  }

  /** Marks done; fenced on the claim (a relay that lost its lease cannot overwrite a newer claim). Returns whether it applied. */
  async markDone(row: ClaimedRow, receipt: object, txHash: string | null): Promise<boolean> {
    const r = await this.prisma.chainOutbox.updateMany({
      where: { id: row.id, status: 'RUNNING', attempts: row.attempts },
      data: { status: 'DONE', receipt, txHash, lockedUntil: null, lastError: null },
    });
    return r.count === 1;
  }

  /** Failure: `FAILED` with the next attempt `delayMs` from now, or `DEAD` when `dead`. Fenced like `markDone`. */
  async markFailed(row: ClaimedRow, error: string, delayMs: number, dead: boolean): Promise<boolean> {
    const msg = error.slice(0, 400);
    const n = dead
      ? await this.prisma.$executeRaw`UPDATE chain.chain_outbox SET status = 'DEAD'::chain.outbox_status, last_error = ${msg}, locked_until = NULL, updated_at = now()
          WHERE id = ${row.id} AND status = 'RUNNING'::chain.outbox_status AND attempts = ${row.attempts}`
      : await this.prisma.$executeRaw`UPDATE chain.chain_outbox SET status = 'FAILED'::chain.outbox_status, last_error = ${msg}, locked_until = NULL,
          next_attempt_at = now() + make_interval(secs => ${delayMs / 1000}), updated_at = now()
          WHERE id = ${row.id} AND status = 'RUNNING'::chain.outbox_status AND attempts = ${row.attempts}`;
    return n === 1;
  }

  /** Rows waiting to be relayed (PENDING, FAILED, RUNNING) and dead rows, for the gauges. */
  async counts(): Promise<{ pending: number; dead: number }> {
    const [pending, dead] = await Promise.all([
      this.prisma.chainOutbox.count({ where: { status: { in: ['PENDING', 'FAILED', 'RUNNING'] } } }),
      this.prisma.chainOutbox.count({ where: { status: 'DEAD' } }),
    ]);
    return { pending, dead };
  }
}
