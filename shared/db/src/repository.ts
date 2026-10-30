import type { Prisma, PrismaClient } from '@prisma/client';

/** The client handed to a function running inside an interactive transaction. */
export type TransactionClient = Prisma.TransactionClient;
/** Either the root client or a transaction client: what a repository method writes through. */
export type DbClient = PrismaClient | TransactionClient;

export interface TransactionOptions {
  readonly maxWait?: number;
  readonly timeout?: number;
  readonly isolationLevel?: Prisma.TransactionIsolationLevel;
}

const isRoot = (db: DbClient): db is PrismaClient => '$transaction' in db;

/**
 * Runs `fn` in an interactive transaction (rolls back when it throws). Given a transaction client it joins that
 * transaction instead of opening a nested one, so helpers compose: `withTransaction(db, (tx) => a(tx) && b(tx))`.
 */
export function withTransaction<T>(db: DbClient, fn: (tx: TransactionClient) => Promise<T>, options?: TransactionOptions): Promise<T> {
  return isRoot(db) ? db.$transaction(fn, options) : fn(db);
}

/**
 * Base for repositories. Methods take an optional `tx` so a caller can compose several writes atomically
 * (e.g. a domain write plus a chain outbox row): `repo.create(data, tx)` writes through `tx ?? this.prisma`.
 */
export abstract class RepositoryBase {
  constructor(protected readonly prisma: PrismaClient) {}

  /** The client to write through: the caller's transaction when given, else the root client. */
  protected db(tx?: DbClient): DbClient {
    return tx ?? this.prisma;
  }

  /** Runs `fn` in a transaction (joins `tx` when given). */
  protected tx<T>(fn: (tx: TransactionClient) => Promise<T>, tx?: DbClient, options?: TransactionOptions): Promise<T> {
    return withTransaction(tx ?? this.prisma, fn, options);
  }
}
