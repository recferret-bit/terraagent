import type { PrismaClient, TransactionClient } from '@terra/db';

/** Shared lock for facts, unlocks, XP and administrative reset, including a pilot's first insert. */
export function withProgressionTransaction<T>(db: PrismaClient, playerId: string, work: (tx: TransactionClient) => Promise<T>): Promise<T> {
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${playerId}, 12))`;
    return work(tx);
  });
}
