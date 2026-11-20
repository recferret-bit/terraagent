import type { DbClient } from '@terra/db';
import { resolveLeadPatron, type PatronCandidate } from './patron-resolver.js';
import { readStakeClock, resolveWallet, type WalletRef } from './stake-clock.reader.js';

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
    if (!this.available) return null;
    const row = (await this.db.stakingPatronSeat.findUnique({ where: { planetId } })) as SeatDbRow | null;
    return row ? toSeat(row) : null;
  }

  /** One nomination per wallet: a wallet's stake backs a single public planet. */
  async nominate(accountId: string, planetId: string): Promise<void> {
    await this.db.stakingPatronNomination.upsert({
      where: { accountId },
      create: { accountId, planetId },
      update: { planetId },
    });
  }

  /** Re-resolves the seat of `planetId` from the current nominations and stakes, then upserts, moves or clears it. */
  async refreshPlanet(planetId: string, nowMs: number = Date.now()): Promise<PatronSeatRow | null> {
    if (!this.available) return null;
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
      if (incumbent) await this.db.stakingPatronSeat.deleteMany({ where: { planetId } });
      return null;
    }
    const keep = incumbent?.accountId === winner.accountId;
    const data = { accountId: winner.accountId, activeStaked: winner.activeStakedYocto.toString(), updatedAt: new Date(nowMs) };
    await this.db.stakingPatronSeat.upsert({
      where: { planetId },
      create: { planetId, ...data, sinceAt: new Date(nowMs) },
      update: keep ? data : { ...data, sinceAt: new Date(nowMs) },
    });
    return { planetId, accountId: winner.accountId, activeStakedYocto: winner.activeStakedYocto, sinceMs: keep ? incumbent.sinceMs : nowMs };
  }

  /**
   * Planet ids on which the wallet is the Lead Patron right now. Refreshes the planets the wallet nominates and the
   * seats it currently holds first, so a stale seat never outlives an unstake.
   */
  async leadPlanetIdsFor(wallet: WalletRef, nowMs: number = Date.now()): Promise<string[]> {
    if (!this.available || wallet.accountIds.length === 0) return [];
    const accounts = [...wallet.accountIds];
    const [noms, held] = await Promise.all([
      this.db.stakingPatronNomination.findMany({ where: { accountId: { in: accounts } }, select: { planetId: true } }),
      this.db.stakingPatronSeat.findMany({ where: { accountId: { in: accounts } }, select: { planetId: true } }),
    ]);
    const planets = new Set<string>([...(noms as Array<{ planetId: string }>), ...(held as Array<{ planetId: string }>)].map((r) => r.planetId));
    const out: string[] = [];
    for (const planetId of [...planets].sort()) {
      const seat = await this.refreshPlanet(planetId, nowMs);
      if (seat && accounts.includes(seat.accountId)) out.push(planetId);
    }
    return out;
  }
}
