import type { PlanetPatronView } from '@terra/contracts';
import { z } from 'zod';
import type { PrismaClient } from '@terra/db';
import { CoreException } from '../../../core/errors/index.js';
import { NearException } from '../../domain/errors.js';
import { PatronSeatService } from '../perks/patron-seat.service.js';
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
    const previous = (await db.stakingPatronNomination.findUnique({ where: { accountId }, select: { planetId: true } })) as
      | { planetId: string }
      | null;
    await seats.nominate(accountId, planet.id);
    const now = this.nowMs();
    if (previous && previous.planetId !== planet.id) await seats.refreshPlanet(previous.planetId, now);
    const seat = await seats.refreshPlanet(planet.id, now);
    return {
      accountId,
      planetId: planet.id,
      isLeadPatron: seat?.accountId === accountId,
      leadPatron: seat ? patronView(seat) : null,
    };
  }
}
