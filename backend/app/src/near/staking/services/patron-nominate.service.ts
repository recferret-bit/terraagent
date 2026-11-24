import {
  isPatronageEligiblePlanetId,
  PATRONAGE_NON_ELIGIBLE_MESSAGE,
  PATRONAGE_PLANET_IDS,
  type PlanetPatronView,
} from '@terra/contracts';
import { z } from 'zod';
import { withTransaction, type DbClient, type PrismaClient } from '@terra/db';
import { CoreException } from '../../../core/errors/index.js';
import { NearException } from '../../domain/errors.js';
import { lockPatronPlanets, PatronSeatService } from '../perks/patron-seat.service.js';
import { resolveWallet } from '../perks/stake-clock.reader.js';
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
    const normalizedPlanetId = planetId.trim();
    if (!isPatronageEligiblePlanetId(normalizedPlanetId)) {
      throw new CoreException('INVALID_REQUEST', {
        status: 400,
        message: PATRONAGE_NON_ELIGIBLE_MESSAGE,
        details: { planetId: normalizedPlanetId, eligiblePlanetIds: PATRONAGE_PLANET_IDS },
      });
    }
    const planet = (await db.planet.findUnique({ where: { id: normalizedPlanetId }, select: { id: true, admission: true } })) as
      | { id: string; admission: string }
      | null;
    if (!planet || planet.admission === 'ARCHIVED') {
      throw new CoreException('NOT_FOUND', { status: 404, message: 'Planet not found or not public.', details: { planetId: normalizedPlanetId } });
    }
    const runInTx = async (tx: DbClient) => {
      const wallet = await resolveWallet(tx, { accountId });
      const walletAccounts = Array.from(new Set([accountId, ...wallet.accountIds]));
      if (typeof (tx as { $executeRaw?: unknown }).$executeRaw === 'function') {
        const raw = tx as { $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown> };
        await raw.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`patron-wallet:${wallet.walletKey}`}, 0))`;
      }
      const txSeats = new PatronSeatService(tx);
      const priorRows =
        typeof tx.stakingPatronNomination?.findMany === 'function'
          ? ((await tx.stakingPatronNomination.findMany({
              where: { accountId: { in: walletAccounts } },
              select: { planetId: true },
            })) as Array<{ planetId: string }>)
          : ((await tx.stakingPatronNomination.findUnique({ where: { accountId }, select: { planetId: true } }).then((r) => (r ? [r] : []))) as Array<{ planetId: string }>);
      const vacatedPlanets = Array.from(new Set(priorRows.map((r) => r.planetId).filter((pid) => pid !== planet.id)));
      await lockPatronPlanets(tx, [planet.id, ...vacatedPlanets]);
      const now = this.nowMs();
      await txSeats.nominate(accountId, planet.id, now);
      for (const prevPlanet of vacatedPlanets) {
        await txSeats.refreshPlanetUnlocked(prevPlanet, now);
      }
      const seat = await txSeats.refreshPlanetUnlocked(planet.id, now);
      return { seat, walletAccounts };
    };
    const { seat, walletAccounts } =
      typeof db.$transaction === 'function' ? await withTransaction(db, runInTx) : await runInTx(db);
    return {
      accountId,
      planetId: planet.id,
      isLeadPatron: Boolean(seat && walletAccounts.includes(seat.accountId)),
      leadPatron: seat ? patronView(seat) : null,
    };
  }
}
