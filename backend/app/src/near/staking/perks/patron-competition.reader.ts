import { randomUUID } from 'node:crypto';
import {
  PATRONAGE_PLANET_IDS,
  STAKING_RULES,
  STAKING_TIERS,
  stakingTierForYocto,
  type PatronContenderRow,
  type PatronContenderStatus,
  type PatronHistoryEventKind,
  type PatronHistoryRow,
  type PlanetPatronCompetitionView,
  type PlanetPatronView,
  type PlanetaryPatronageView,
} from '@terra/contracts';
import type { DbClient } from '@terra/db';
import { ONE_NEAR_YOCTO, yoctoToNear } from '../yocto.js';
import { carrierNameFor, comparePatronCandidates, PATRON_MIN_YOCTO, resolveLeadPatron, type PatronCandidate } from './patron-resolver.js';
import { readStakeClock, resolveWallet, type WalletRef } from './stake-clock.reader.js';

const HISTORY_LIMIT = 20;
const CONTENDER_LIMIT = 200;

const KIND_PRIORITY: Readonly<Record<PatronHistoryEventKind, number>> = {
  seat_overtaken: 0,
  seat_claimed: 1,
  seat_vacated: 2,
  fee_payout: 3,
  nominated: 4,
};

interface Dec {
  toFixed(n: number): string;
}

interface SeatDbRow {
  readonly planetId: string;
  readonly accountId: string;
  readonly activeStaked: Dec;
  readonly sinceAt: Date;
}

interface NomDbRow {
  readonly accountId: string;
  readonly createdAt: Date;
}

interface HistoryDbRow {
  readonly id: string;
  readonly planetId: string;
  readonly accountId: string;
  readonly kind: string;
  readonly activeStaked: Dec;
  readonly previousAccountId: string | null;
  readonly previousStaked: Dec | null;
  readonly createdAt: Date;
}

interface PayoutDbRow {
  readonly id: string;
  readonly planetId: string;
  readonly accountId: string;
  readonly amountUsdcAtomic: Dec;
  readonly createdAt: Date;
}

interface CandidateMeta extends PatronCandidate {
  readonly walletKey: string;
  readonly accountIds: readonly string[];
  readonly nominatedAtMs: number;
}

export interface RecordPatronHistoryInput {
  readonly planetId: string;
  readonly accountId: string;
  readonly kind: 'seat_claimed' | 'seat_overtaken' | 'seat_vacated' | 'nominated';
  readonly activeStakedYocto: bigint;
  readonly previousAccountId?: string | null;
  readonly previousStakedYocto?: bigint | null;
  readonly atMs: number;
}

const big = (d: Dec | null | undefined): bigint => (d ? BigInt(d.toFixed(0)) : 0n);

/** Persists a King-of-the-Hill event when `chain.staking_patron_history` is available; safe no-op on lightweight test doubles. */
export async function recordPatronHistoryEvent(db: DbClient, input: RecordPatronHistoryInput): Promise<void> {
  if (typeof db.stakingPatronHistory?.create !== 'function') return;
  await db.stakingPatronHistory.create({
    data: {
      id: `ph_${input.atMs}_${randomUUID().slice(0, 8)}`,
      planetId: input.planetId,
      accountId: input.accountId,
      kind: input.kind,
      activeStaked: input.activeStakedYocto.toString(),
      previousAccountId: input.previousAccountId ?? null,
      previousStaked:
        input.previousStakedYocto !== undefined && input.previousStakedYocto !== null
          ? input.previousStakedYocto.toString()
          : null,
      createdAt: new Date(Math.max(0, input.atMs)),
    },
  });
}

async function readViewerNomination(db: DbClient, viewerWallet: WalletRef): Promise<string | null> {
  if (viewerWallet.accountIds.length === 0 || typeof db.stakingPatronNomination?.findMany !== 'function') return null;
  const rows = (await db.stakingPatronNomination.findMany({
    where: { accountId: { in: [...viewerWallet.accountIds] } },
    orderBy: { createdAt: 'desc' },
    select: { planetId: true },
    take: 1,
  })) as Array<{ planetId: string }>;
  const id = rows[0]?.planetId ?? null;
  return id && PATRONAGE_PLANET_IDS.includes(id) ? id : null;
}

async function loadPlanetCandidates(
  db: DbClient,
  planetId: string,
  noms: readonly NomDbRow[],
  seatRow: SeatDbRow | null,
): Promise<CandidateMeta[]> {
  const byWallet = new Map<string, CandidateMeta>();
  for (const nom of noms) {
    const wallet = await resolveWallet(db, { accountId: nom.accountId });
    const nomMs = Math.max(0, nom.createdAt.getTime());
    const existing = byWallet.get(wallet.walletKey);
    if (existing) {
      if (nomMs < existing.nominatedAtMs) byWallet.set(wallet.walletKey, { ...existing, nominatedAtMs: nomMs });
      continue;
    }
    const clock = await readStakeClock(db, wallet);
    byWallet.set(wallet.walletKey, {
      accountId: nom.accountId,
      walletKey: wallet.walletKey,
      accountIds: wallet.accountIds,
      activeStakedYocto: clock.activeStakedYocto,
      stakedSinceMs: clock.stakedSinceMs,
      nominatedAtMs: nomMs,
    });
  }
  if (seatRow) {
    const seatWallet = await resolveWallet(db, { accountId: seatRow.accountId });
    if (!byWallet.has(seatWallet.walletKey)) {
      const clock = await readStakeClock(db, seatWallet);
      const seatYocto = big(seatRow.activeStaked);
      const activeStakedYocto = clock.activeStakedYocto > 0n ? clock.activeStakedYocto : seatYocto;
      const sinceMs = Math.max(0, seatRow.sinceAt.getTime());
      byWallet.set(seatWallet.walletKey, {
        accountId: seatRow.accountId,
        walletKey: seatWallet.walletKey,
        accountIds: seatWallet.accountIds,
        activeStakedYocto,
        stakedSinceMs: clock.stakedSinceMs ?? sinceMs,
        nominatedAtMs: sinceMs,
      });
    }
  }
  const incumbent = seatRow?.accountId ?? null;
  return [...byWallet.values()].sort((a, b) => comparePatronCandidates(a, b, incumbent));
}

function buildContenderRows(
  candidates: readonly CandidateMeta[],
  winner: CandidateMeta | null,
  viewerWallet: WalletRef,
): PatronContenderRow[] {
  const viewerAccounts = new Set(viewerWallet.accountIds);
  return candidates.map((c, idx) => {
    const isLead = winner !== null && c.accountId === winner.accountId;
    const eligible = c.activeStakedYocto >= PATRON_MIN_YOCTO;
    const status: PatronContenderStatus = isLead ? 'lead' : eligible ? 'contender' : 'below_threshold';
    const gapYocto = isLead
      ? 0n
      : winner
        ? winner.activeStakedYocto > c.activeStakedYocto
          ? winner.activeStakedYocto - c.activeStakedYocto
          : ONE_NEAR_YOCTO
        : PATRON_MIN_YOCTO > c.activeStakedYocto
          ? PATRON_MIN_YOCTO - c.activeStakedYocto
          : 0n;
    const isSelf =
      (viewerWallet.walletKey !== 'anonymous' && c.walletKey === viewerWallet.walletKey) ||
      c.accountIds.some((acct) => viewerAccounts.has(acct));
    return {
      rank: idx + 1,
      accountId: c.accountId,
      carrierName: carrierNameFor(c.accountId),
      activeStakedNear: yoctoToNear(c.activeStakedYocto, 6),
      tier: stakingTierForYocto(c.activeStakedYocto).id,
      status,
      gapToLeadNear: yoctoToNear(gapYocto, 6),
      stakedSinceMs: c.stakedSinceMs !== null ? Math.max(0, c.stakedSinceMs) : null,
      nominatedAtMs: c.nominatedAtMs,
      isSelf,
    };
  });
}

async function readPlanetHistory(
  db: DbClient,
  planetId: string,
  seatRow: SeatDbRow | null,
  noms: readonly NomDbRow[],
  stakesByAccount: ReadonlyMap<string, bigint>,
): Promise<PatronHistoryRow[]> {
  const [histRows, payoutRows] = await Promise.all([
    typeof db.stakingPatronHistory?.findMany === 'function'
      ? (db.stakingPatronHistory.findMany({
          where: { planetId },
          orderBy: { createdAt: 'desc' },
          take: HISTORY_LIMIT,
        }) as Promise<HistoryDbRow[]>)
      : Promise.resolve([] as HistoryDbRow[]),
    typeof db.stakingPatronPayout?.findMany === 'function'
      ? (db.stakingPatronPayout.findMany({
          where: { planetId },
          orderBy: { createdAt: 'desc' },
          take: HISTORY_LIMIT,
        }) as Promise<PayoutDbRow[]>)
      : Promise.resolve([] as PayoutDbRow[]),
  ]);

  const merged: PatronHistoryRow[] = [];
  for (const r of histRows) {
    const kind = r.kind as PatronHistoryEventKind;
    merged.push({
      id: r.id,
      planetId: r.planetId,
      accountId: r.accountId,
      carrierName: carrierNameFor(r.accountId),
      kind,
      activeStakedNear: yoctoToNear(big(r.activeStaked), 6),
      previousAccountId: r.previousAccountId,
      previousStakedNear: r.previousStaked !== null ? yoctoToNear(big(r.previousStaked), 6) : null,
      payoutUsd: null,
      atMs: Math.max(0, r.createdAt.getTime()),
    });
  }
  for (const p of payoutRows) {
    const seatStake = seatRow && seatRow.accountId === p.accountId ? big(seatRow.activeStaked) : stakesByAccount.get(p.accountId) ?? 0n;
    merged.push({
      id: `payout:${p.id}`,
      planetId: p.planetId,
      accountId: p.accountId,
      carrierName: carrierNameFor(p.accountId),
      kind: 'fee_payout',
      activeStakedNear: yoctoToNear(seatStake, 6),
      previousAccountId: null,
      previousStakedNear: null,
      payoutUsd: Number(big(p.amountUsdcAtomic)) / 1e6,
      atMs: Math.max(0, p.createdAt.getTime()),
    });
  }

  if (histRows.length < HISTORY_LIMIT) {
    if (
      seatRow &&
      !merged.some((e) => e.accountId === seatRow.accountId && (e.kind === 'seat_claimed' || e.kind === 'seat_overtaken'))
    ) {
      merged.push({
        id: `seed-seat:${planetId}:${seatRow.accountId}`,
        planetId,
        accountId: seatRow.accountId,
        carrierName: carrierNameFor(seatRow.accountId),
        kind: 'seat_claimed',
        activeStakedNear: yoctoToNear(big(seatRow.activeStaked), 6),
        previousAccountId: null,
        previousStakedNear: null,
        payoutUsd: null,
        atMs: Math.max(0, seatRow.sinceAt.getTime()),
      });
    }
    for (const nom of noms) {
      if (merged.some((e) => e.accountId === nom.accountId && e.kind === 'nominated')) continue;
      merged.push({
        id: `seed-nom:${planetId}:${nom.accountId}`,
        planetId,
        accountId: nom.accountId,
        carrierName: carrierNameFor(nom.accountId),
        kind: 'nominated',
        activeStakedNear: yoctoToNear(stakesByAccount.get(nom.accountId) ?? 0n, 6),
        previousAccountId: null,
        previousStakedNear: null,
        payoutUsd: null,
        atMs: Math.max(0, nom.createdAt.getTime()),
      });
    }
  }

  return merged
    .sort((a, b) => b.atMs - a.atMs || KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind] || b.id.localeCompare(a.id))
    .slice(0, HISTORY_LIMIT);
}

async function readPlanetCompetition(
  db: DbClient,
  planetId: string,
  viewerWallet: WalletRef,
): Promise<PlanetPatronCompetitionView> {
  const [noms, seatRow] = await Promise.all([
    typeof db.stakingPatronNomination?.findMany === 'function'
      ? (db.stakingPatronNomination.findMany({
          where: { planetId },
          orderBy: { createdAt: 'asc' },
          select: { accountId: true, createdAt: true },
          take: CONTENDER_LIMIT,
        }) as Promise<NomDbRow[]>)
      : Promise.resolve([] as NomDbRow[]),
    typeof db.stakingPatronSeat?.findUnique === 'function'
      ? (db.stakingPatronSeat.findUnique({ where: { planetId } }) as Promise<SeatDbRow | null>)
      : Promise.resolve(null),
  ]);

  const candidates = await loadPlanetCandidates(db, planetId, noms, seatRow);
  const incumbent = seatRow?.accountId ?? null;
  const resolved = resolveLeadPatron(candidates, incumbent);
  const winner = resolved ? candidates.find((c) => c.accountId === resolved.accountId) ?? null : null;
  const leadPatron: PlanetPatronView | null = winner
    ? {
        planetId,
        accountId: winner.accountId,
        carrierName: carrierNameFor(winner.accountId),
        activeStakedNear: yoctoToNear(winner.activeStakedYocto, 6),
        sinceMs:
          seatRow && seatRow.accountId === winner.accountId
            ? Math.max(0, seatRow.sinceAt.getTime())
            : winner.nominatedAtMs,
        protocolFeeShareBp: STAKING_RULES.patronProtocolFeeShareBp,
      }
    : null;
  const contenders = buildContenderRows(candidates, winner, viewerWallet);
  const stakesByAccount = new Map(candidates.map((c) => [c.accountId, c.activeStakedYocto]));
  const history = await readPlanetHistory(db, planetId, seatRow, noms, stakesByAccount);
  return {
    planetId,
    leadPatron,
    stakeToLeadNear: winner ? yoctoToNear(winner.activeStakedYocto, 6) : String(STAKING_TIERS[4]!.minStakeNear),
    totalContenders: contenders.length,
    contenders,
    history,
  };
}

/** Reads the King-of-the-Hill competition standings and chronological history for all 3 canonical worlds. */
export async function readPlanetaryPatronage(db: DbClient, viewerWallet: WalletRef): Promise<PlanetaryPatronageView> {
  const [nominatedPlanetId, planets] = await Promise.all([
    readViewerNomination(db, viewerWallet),
    Promise.all(PATRONAGE_PLANET_IDS.map((planetId) => readPlanetCompetition(db, planetId, viewerWallet))),
  ]);
  return { nominatedPlanetId, planets };
}
