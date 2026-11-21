import type { PlanetPatronView } from '@terra/contracts';
import { z } from 'zod';
import { withTransaction, type DbClient, type PrismaClient } from '@terra/db';
import { CoreException } from '../../../core/errors/index.js';
import { NearException } from '../../domain/errors.js';
import { lockPatronPlanets, PatronSeatService } from '../perks/patron-seat.service.js';
import { patronView } from '../perks/staking-perks.service.js';

/** `POST /v1/near/staking/patron/nominate` body. */
export const PatronNominateRequest = z.strictObject({
  accountId: z.string().min(2).max(64),
  planetId: z.string().min(1).max(80),
});
export type PatronNominateRequest = z.infer<typeof PatronNominateRequest>;

export interface PatronNominationResult {
  readonly accountId: string;
  readonly planetId: string;
  /** `true` when this wallet holds the Lead Patron seat of the planet after the nomination. */
  readonly isLeadPatron: boolean;
  readonly leadPatron: PlanetPatronView | null;
}

/**
 * `POST /v1/near/staking/patron/nominate`: a wallet backs one public planet in the King-of-the-Hill race. The seat is
 * resolved from the wallet's ACTIVE stake (`PatronSeatService.refreshPlanet`), so a nomination alone never grants it.
 * A planet is public unless it is `ARCHIVED` (every canonical world is open to every pilot; there is no private flag).
 * Moving a nomination re-resolves the old planet too, so its seat passes to the runner-up at once.
 */
export class PatronNominateService {
  constructor(
    private readonly db: () => PrismaClient | null,
    private readonly nowMs: () => number,
  ) {}

  async nominate(accountId: string, planetId: string): Promise<PatronNominationResult> {
    const db = this.db();
    const seats = db ? new PatronSeatService(db) : null;
    if (!db || !seats?.available) {
      throw new NearException('NEAR_UNAVAILABLE', { message: 'Patron nominations need the database.' });
    }
    const planet = (await db.planet.findUnique({ where: { id: planetId }, select: { id: true, admission: true } })) as
      | { id: string; admission: string }
      | null;
    if (!planet || planet.admission === 'ARCHIVED') {
      throw new CoreException('NOT_FOUND', { status: 404, message: 'Planet not found or not public.', details: { planetId } });
    }
    const runInTx = async (tx: DbClient) => {
      if (typeof (tx as { $executeRaw?: unknown }).$executeRaw === 'function') {
        const raw = tx as { $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown> };
        await raw.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`patron-acct:${accountId}`}, 0))`;
      }
      const txSeats = new PatronSeatService(tx);
      const previous = (await tx.stakingPatronNomination.findUnique({ where: { accountId }, select: { planetId: true } })) as
        | { planetId: string }
        | null;
      await lockPatronPlanets(tx, [planet.id, ...(previous ? [previous.planetId] : [])]);
      await txSeats.nominate(accountId, planet.id);
      const now = this.nowMs();
      if (previous && previous.planetId !== planet.id) await txSeats.refreshPlanetUnlocked(previous.planetId, now);
      return txSeats.refreshPlanetUnlocked(planet.id, now);
    };
    const seat = typeof db.$transaction === 'function' ? await withTransaction(db, runInTx) : await runInTx(db);
    return {
      accountId,
      planetId: planet.id,
      isLeadPatron: seat?.accountId === accountId,
      leadPatron: seat ? patronView(seat) : null,
    };
  }
}
