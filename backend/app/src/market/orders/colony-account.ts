import type { DbClient } from '@terra/db';
import { resolveColonyAccountId } from '../../near/cargo/cargo-export-outbox.js';

/**
 * `resolveColonyAccountId` for the market: it lazily creates the mock chain account of an unknown colony, so two concurrent
 * first requests can collide on the unique key. Call it outside the order transaction (a failed statement would abort
 * that) and retry once; the loser then reads the winner's row.
 */
export async function resolveMarketAccountId(db: DbClient, colonyId: string, playerId: string | null, planetId: string, colonyIndex: number): Promise<string> {
  try {
    return await resolveColonyAccountId(db, colonyId, playerId, planetId, colonyIndex);
  } catch (err) {
    if ((err as { code?: string }).code !== 'P2002') throw err;
    return resolveColonyAccountId(db, colonyId, playerId, planetId, colonyIndex);
  }
}
