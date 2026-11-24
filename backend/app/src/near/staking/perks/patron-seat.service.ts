import { isPatronageEligiblePlanetId, PATRONAGE_NON_ELIGIBLE_MESSAGE, PATRONAGE_PLANET_IDS } from '@terra/contracts';
import { withTransaction, type DbClient, type PrismaClient } from '@terra/db';
import { CoreException } from '../../../core/errors/index.js';
import { recordPatronHistoryEvent } from './patron-competition.reader.js';
import { resolveLeadPatron, type PatronCandidate } from './patron-resolver.js';
import { readStakeClock, resolveWallet, type WalletRef } from './stake-clock.reader.js';
import { stakingNowMs } from './perks-deps.js';

export async function lockPatronPlanets(tx: DbClient, planetIds: readonly string[]): Promise<void> {
  if (typeof (tx as { $executeRaw?: unknown }).$executeRaw !== 'function') return;
  const raw = tx as { $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown> };
  for (const id of [...new Set(planetIds.filter(Boolean))].sort()) {
    await raw.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`patron:${id}`}, 0))`;
  }
}

export async function withPatronPlanetLocks<T>(
  db: DbClient,
  planetIds: readonly string[],
  fn: (tx: DbClient) => Promise<T>,
): Promise<T> {
  if (typeof (db as PrismaClient).$transaction === 'function') {
    return withTransaction(db as PrismaClient, async (tx) => {
      await lockPatronPlanets(tx, planetIds);
      return fn(tx);
    });
  }
  await lockPatronPlanets(db, planetIds);
  return fn(db);
}

export interface PatronSeatRow {
  readonly planetId: string;
  readonly accountId: string;
  readonly activeStakedYocto: bigint;
  readonly sinceMs: number;
}

interface SeatDbRow {
  readonly planetId: string;
  readonly accountId: string;
  readonly activeStaked: { toFixed(n: number): string };
  readonly sinceAt: Date;
}

const toSeat = (r: SeatDbRow): PatronSeatRow => ({
  planetId: r.planetId,
  accountId: r.accountId,
  activeStakedYocto: BigInt(r.activeStaked.toFixed(0)),
  sinceMs: r.sinceAt.getTime(),
});

/**
 * King-of-the-Hill seats on Postgres: reads `chain.staking_patron_nomination` + wallet stake and upserts
 * `chain.staking_patron_seat` through the pure `resolveLeadPatron`. Every evaluation re-reads the stakes, so an
 * unstake below the runner-up (or below the Tier 4 minimum) transfers or clears the seat immediately.
 */
export class PatronSeatService {
  constructor(private readonly db: DbClient) {}

  get available(): boolean {
    return typeof this.db.stakingPatronSeat?.findUnique === 'function' && typeof this.db.stakingPatronNomination?.findMany === 'function';
  }

  async getSeat(planetId: string): Promise<PatronSeatRow | null> {
    if (!this.available || !isPatronageEligiblePlanetId(planetId)) return null;
    const row = (await this.db.stakingPatronSeat.findUnique({ where: { planetId } })) as SeatDbRow | null;
    return row ? toSeat(row) : null;
  }

  /** One nomination per wallet: a wallet's stake backs one of the three canonical public planets. */
  async nominate(accountId: string, planetId: string, nowMs: number = stakingNowMs()): Promise<void> {
    const normalizedPlanetId = planetId.trim();
    if (!isPatronageEligiblePlanetId(normalizedPlanetId)) {
      throw new CoreException('INVALID_REQUEST', {
        status: 400,
        message: PATRONAGE_NON_ELIGIBLE_MESSAGE,
        details: { planetId: normalizedPlanetId, eligiblePlanetIds: PATRONAGE_PLANET_IDS },
      });
    }
    const wallet = await resolveWallet(this.db, { accountId });
    const siblingAccounts = wallet.accountIds.filter((a) => a !== accountId);
    if (siblingAccounts.length > 0 && typeof this.db.stakingPatronNomination?.deleteMany === 'function') {
      await this.db.stakingPatronNomination.deleteMany({
        where: { accountId: { in: siblingAccounts }, planetId: { not: normalizedPlanetId } },
      });
    }
    const prev =
      typeof this.db.stakingPatronNomination?.findUnique === 'function'
        ? ((await this.db.stakingPatronNomination.findUnique({ where: { accountId }, select: { planetId: true } })) as
            | { planetId: string }
            | null)
        : null;
    const changed = !prev || prev.planetId !== normalizedPlanetId;
    await this.db.stakingPatronNomination.upsert({
      where: { accountId },
      create: { accountId, planetId: normalizedPlanetId, createdAt: new Date(nowMs) },
      update: changed ? { planetId: normalizedPlanetId, createdAt: new Date(nowMs) } : { planetId: normalizedPlanetId },
    });
    if (changed) {
      const clock = await readStakeClock(this.db, wallet);
      await recordPatronHistoryEvent(this.db, {
        planetId: normalizedPlanetId,
        accountId,
        kind: 'nominated',
        activeStakedYocto: clock.activeStakedYocto,
        atMs: nowMs,
      });
    }
  }

  /** Re-resolves the seat of `planetId` from the current nominations and stakes, then upserts, moves or clears it. */
  async refreshPlanet(planetId: string, nowMs: number = stakingNowMs()): Promise<PatronSeatRow | null> {
    if (!this.available) return null;
    return withPatronPlanetLocks(this.db, [planetId], (tx) => new PatronSeatService(tx).refreshPlanetUnlocked(planetId, nowMs));
  }

  async refreshPlanetUnlocked(planetId: string, nowMs: number = stakingNowMs()): Promise<PatronSeatRow | null> {
    if (!this.available) return null;
    if (!isPatronageEligiblePlanetId(planetId)) {
      await this.db.stakingPatronSeat.deleteMany({ where: { planetId } });
      return null;
    }
    const noms = (await this.db.stakingPatronNomination.findMany({
      where: { planetId },
      orderBy: { createdAt: 'asc' },
      select: { accountId: true },
    })) as Array<{ accountId: string }>;
    const byWallet = new Map<string, PatronCandidate>();
    for (const { accountId } of noms) {
      const wallet = await resolveWallet(this.db, { accountId });
      if (byWallet.has(wallet.walletKey)) continue;
      const clock = await readStakeClock(this.db, wallet);
      byWallet.set(wallet.walletKey, { accountId, activeStakedYocto: clock.activeStakedYocto, stakedSinceMs: clock.stakedSinceMs });
    }
    const incumbent = await this.getSeat(planetId);
    const winner = resolveLeadPatron([...byWallet.values()], incumbent?.accountId ?? null);
    if (!winner) {
      if (incumbent) {
        await this.db.stakingPatronSeat.deleteMany({ where: { planetId } });
        const incumbentCandidate = [...byWallet.values()].find((c) => c.accountId === incumbent.accountId);
        const currentStake =
          incumbentCandidate?.activeStakedYocto ??
          (await readStakeClock(this.db, await resolveWallet(this.db, { accountId: incumbent.accountId }))).activeStakedYocto;
        await recordPatronHistoryEvent(this.db, {
          planetId,
          accountId: incumbent.accountId,
          kind: 'seat_vacated',
          activeStakedYocto: currentStake,
          previousAccountId: incumbent.accountId,
          previousStakedYocto: incumbent.activeStakedYocto,
          atMs: nowMs,
        });
      }
      return null;
    }
    const keep = incumbent?.accountId === winner.accountId;
    const data = { accountId: winner.accountId, activeStaked: winner.activeStakedYocto.toString(), updatedAt: new Date(nowMs) };
    await this.db.stakingPatronSeat.upsert({
      where: { planetId },
      create: { planetId, ...data, sinceAt: new Date(nowMs) },
      update: keep ? data : { ...data, sinceAt: new Date(nowMs) },
    });
    if (!incumbent) {
      await recordPatronHistoryEvent(this.db, {
        planetId,
        accountId: winner.accountId,
        kind: 'seat_claimed',
        activeStakedYocto: winner.activeStakedYocto,
        atMs: nowMs,
      });
    } else if (incumbent.accountId !== winner.accountId) {
      await recordPatronHistoryEvent(this.db, {
        planetId,
        accountId: winner.accountId,
        kind: 'seat_overtaken',
        activeStakedYocto: winner.activeStakedYocto,
        previousAccountId: incumbent.accountId,
        previousStakedYocto: incumbent.activeStakedYocto,
        atMs: nowMs,
      });
    }
    return { planetId, accountId: winner.accountId, activeStakedYocto: winner.activeStakedYocto, sinceMs: keep ? incumbent.sinceMs : nowMs };
  }

  /**
   * Planet ids on which the wallet is the Lead Patron right now. Refreshes the planets the wallet nominates and the
   * seats it currently holds first, so a stale seat never outlives an unstake.
   */
  async leadPlanetIdsFor(wallet: WalletRef, nowMs: number = stakingNowMs()): Promise<string[]> {
    if (!this.available || wallet.accountIds.length === 0) return [];
    const accounts = [...wallet.accountIds];
    const [noms, held] = await Promise.all([
      this.db.stakingPatronNomination.findMany({ where: { accountId: { in: accounts } }, select: { planetId: true } }),
      this.db.stakingPatronSeat.findMany({ where: { accountId: { in: accounts } }, select: { planetId: true } }),
    ]);
    const planets = new Set<string>([...(noms as Array<{ planetId: string }>), ...(held as Array<{ planetId: string }>)].map((r) => r.planetId));
    const out: string[] = [];
    for (const planetId of [...planets].filter((id) => isPatronageEligiblePlanetId(id)).sort()) {
      const seat = await this.refreshPlanet(planetId, nowMs);
      if (seat && accounts.includes(seat.accountId)) out.push(planetId);
    }
    return out;
  }
}
