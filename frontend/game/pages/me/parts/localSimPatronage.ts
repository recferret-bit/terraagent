import {
  CANONICAL_PLANETS,
  PATRONAGE_PLANET_IDS,
  STAKING_RULES,
  stakingTierFor,
  type PatronContenderRow,
  type PatronContenderStatus,
  type PatronHistoryEventKind,
  type PatronHistoryRow,
  type PlanetPatronCompetitionView,
  type PlanetPatronView,
  type PlanetaryPatronageView,
} from '@terra/contracts';
import type { LocalSimState } from './localSimPersonas';

const DAY_MS = 86_400_000;
const PATRON_MIN_NEAR = 500;
const fmt6 = (n: number): string => Math.max(0, Number.isFinite(n) ? n : 0).toFixed(6).replace(/\.?0+$/, '') || '0';

export const localCarrierName = (accountId: string): string => `ISS ${accountId.split('.')[0] ?? accountId}.near`;

interface RivalSpec {
  readonly accountId: string;
  readonly activeNear: number;
  readonly sinceOffsetMs: number;
  readonly nomOffsetMs: number;
}

interface BaselineHistorySpec {
  readonly id: string;
  readonly accountId: string;
  readonly kind: PatronHistoryEventKind;
  readonly activeNear: number;
  readonly previousAccountId: string | null;
  readonly previousNear: number | null;
  readonly payoutUsd: number | null;
  readonly offsetMs: number;
}

interface PlanetBaseline {
  readonly initialHolder: string | null;
  readonly rivals: readonly RivalSpec[];
  readonly history: readonly BaselineHistorySpec[];
}

const BASELINES: Readonly<Record<string, PlanetBaseline>> = {
  [CANONICAL_PLANETS.desert.id]: {
    initialHolder: 'helios-archon.near',
    rivals: [
      { accountId: 'helios-archon.near', activeNear: 620, sinceOffsetMs: 14 * DAY_MS, nomOffsetMs: 14 * DAY_MS },
      { accountId: 'dune-mining.near', activeNear: 510, sinceOffsetMs: 9 * DAY_MS, nomOffsetMs: 8 * DAY_MS },
    ],
    history: [
      { id: 'loc-d-pay', accountId: 'helios-archon.near', kind: 'fee_payout', activeNear: 620, previousAccountId: null, previousNear: null, payoutUsd: 18.42, offsetMs: 1 * DAY_MS },
      { id: 'loc-d-ovt', accountId: 'helios-archon.near', kind: 'seat_overtaken', activeNear: 620, previousAccountId: 'dune-mining.near', previousNear: 510, payoutUsd: null, offsetMs: 6 * DAY_MS },
      { id: 'loc-d-clm', accountId: 'dune-mining.near', kind: 'seat_claimed', activeNear: 510, previousAccountId: null, previousNear: null, payoutUsd: null, offsetMs: 8 * DAY_MS },
    ],
  },
  [CANONICAL_PLANETS.ocean.id]: {
    initialHolder: 'coral-syndicate.near',
    rivals: [
      { accountId: 'coral-syndicate.near', activeNear: 540, sinceOffsetMs: 11 * DAY_MS, nomOffsetMs: 11 * DAY_MS },
      { accountId: 'tidal-scout.near', activeNear: 240, sinceOffsetMs: 5 * DAY_MS, nomOffsetMs: 4 * DAY_MS },
    ],
    history: [
      { id: 'loc-o-pay', accountId: 'coral-syndicate.near', kind: 'fee_payout', activeNear: 540, previousAccountId: null, previousNear: null, payoutUsd: 11.85, offsetMs: 2 * DAY_MS },
      { id: 'loc-o-nom', accountId: 'tidal-scout.near', kind: 'nominated', activeNear: 240, previousAccountId: null, previousNear: null, payoutUsd: null, offsetMs: 4 * DAY_MS },
      { id: 'loc-o-clm', accountId: 'coral-syndicate.near', kind: 'seat_claimed', activeNear: 540, previousAccountId: null, previousNear: null, payoutUsd: null, offsetMs: 11 * DAY_MS },
    ],
  },
  [CANONICAL_PLANETS.temperate.id]: {
    initialHolder: null,
    rivals: [
      { accountId: 'hollow-warden.near', activeNear: 460, sinceOffsetMs: 7 * DAY_MS, nomOffsetMs: 6 * DAY_MS },
      { accountId: 'basalt-pioneer.near', activeNear: 180, sinceOffsetMs: 3 * DAY_MS, nomOffsetMs: 3 * DAY_MS },
    ],
    history: [
      { id: 'loc-t-vac', accountId: 'hollow-warden.near', kind: 'seat_vacated', activeNear: 460, previousAccountId: 'hollow-warden.near', previousNear: 520, payoutUsd: null, offsetMs: 2 * DAY_MS },
      { id: 'loc-t-nom', accountId: 'basalt-pioneer.near', kind: 'nominated', activeNear: 180, previousAccountId: null, previousNear: null, payoutUsd: null, offsetMs: 3 * DAY_MS },
      { id: 'loc-t-clm', accountId: 'hollow-warden.near', kind: 'seat_claimed', activeNear: 520, previousAccountId: null, previousNear: null, payoutUsd: null, offsetMs: 6 * DAY_MS },
    ],
  },
};

const KIND_PRIORITY: Readonly<Record<PatronHistoryEventKind, number>> = {
  seat_overtaken: 0,
  seat_claimed: 1,
  seat_vacated: 2,
  fee_payout: 3,
  nominated: 4,
};

interface Candidate {
  readonly accountId: string;
  readonly activeNear: number;
  readonly stakedSinceMs: number | null;
  readonly nominatedAtMs: number;
  readonly isSelf: boolean;
}

const totalActive = (s: LocalSimState): number => s.nativeStaked + s.stNear + s.liNear;

function ensurePatronState(s: LocalSimState, nowMs: number): number {
  const anchor = (s.patronAnchorMs ??= nowMs);
  s.patronHistory ??= [];
  if (!s.patronSeats) {
    s.patronSeats = {};
    for (const id of PATRONAGE_PLANET_IDS) {
      s.patronSeats[id] = BASELINES[id]?.initialHolder ?? null;
    }
  }
  return anchor;
}

function candidatesForPlanet(s: LocalSimState, planetId: string, anchor: number, nowMs: number): Candidate[] {
  const base = BASELINES[planetId];
  const list: Candidate[] = (base?.rivals ?? []).map((r) => ({
    accountId: r.accountId,
    activeNear: r.activeNear,
    stakedSinceMs: Math.max(0, anchor - r.sinceOffsetMs),
    nominatedAtMs: Math.max(0, anchor - r.nomOffsetMs),
    isSelf: false,
  }));
  if (s.nominatedPlanet === planetId) {
    list.push({
      accountId: s.accountId,
      activeNear: totalActive(s),
      stakedSinceMs: s.stakedSinceMs,
      nominatedAtMs: s.nominatedAtMs ?? nowMs,
      isSelf: true,
    });
  }
  const incumbent = s.patronSeats?.[planetId] ?? base?.initialHolder ?? null;
  return list.sort((a, b) => {
    const aElig = a.activeNear >= PATRON_MIN_NEAR;
    const bElig = b.activeNear >= PATRON_MIN_NEAR;
    if (aElig !== bElig) return aElig ? -1 : 1;
    if (a.activeNear !== b.activeNear) return b.activeNear - a.activeNear;
    if (aElig && incumbent) {
      if (a.accountId === incumbent) return -1;
      if (b.accountId === incumbent) return 1;
    }
    const sa = a.stakedSinceMs ?? Number.POSITIVE_INFINITY;
    const sb = b.stakedSinceMs ?? Number.POSITIVE_INFINITY;
    if (sa !== sb) return sa - sb;
    return a.accountId.localeCompare(b.accountId);
  });
}

function winnerForPlanet(candidates: readonly Candidate[]): Candidate | null {
  const top = candidates[0];
  return top && top.activeNear >= PATRON_MIN_NEAR ? top : null;
}

/** Synchronizes seat ownership across all 3 canonical worlds and appends claim/overtake/vacate events to `s.patronHistory`. */
export function syncLocalPatronSeats(s: LocalSimState, nowMs: number): void {
  const anchor = ensurePatronState(s, nowMs);
  if (totalActive(s) > 0 && !s.nominatedPlanet) {
    const target = CANONICAL_PLANETS.temperate.id;
    s.nominatedPlanet = target;
    s.nominatedAtMs = nowMs;
    s.patronHistory!.unshift({
      id: `loc_${nowMs}_${s.patronHistory!.length + 1}`,
      planetId: target,
      accountId: s.accountId,
      carrierName: localCarrierName(s.accountId),
      kind: 'nominated',
      activeStakedNear: fmt6(totalActive(s)),
      previousAccountId: null,
      previousStakedNear: null,
      payoutUsd: null,
      atMs: nowMs,
    });
  }
  for (const planetId of PATRONAGE_PLANET_IDS) {
    const candidates = candidatesForPlanet(s, planetId, anchor, nowMs);
    const winner = winnerForPlanet(candidates);
    const prevId = s.patronSeats![planetId] ?? null;
    const nextId = winner?.accountId ?? null;
    if (prevId === nextId) continue;

    const prevNear =
      candidates.find((c) => c.accountId === prevId)?.activeNear ??
      (prevId === s.accountId ? totalActive(s) : BASELINES[planetId]?.rivals.find((r) => r.accountId === prevId)?.activeNear ?? 500);

    if (!prevId && winner) {
      s.patronHistory!.unshift({
        id: `loc_${nowMs}_${s.patronHistory!.length + 1}`,
        planetId,
        accountId: winner.accountId,
        carrierName: localCarrierName(winner.accountId),
        kind: 'seat_claimed',
        activeStakedNear: fmt6(winner.activeNear),
        previousAccountId: null,
        previousStakedNear: null,
        payoutUsd: null,
        atMs: nowMs,
      });
    } else if (prevId && !winner) {
      s.patronHistory!.unshift({
        id: `loc_${nowMs}_${s.patronHistory!.length + 1}`,
        planetId,
        accountId: prevId,
        carrierName: localCarrierName(prevId),
        kind: 'seat_vacated',
        activeStakedNear: fmt6(prevNear),
        previousAccountId: prevId,
        previousStakedNear: fmt6(Math.max(prevNear, PATRON_MIN_NEAR)),
        payoutUsd: null,
        atMs: nowMs,
      });
    } else if (prevId && winner && prevId !== winner.accountId) {
      s.patronHistory!.unshift({
        id: `loc_${nowMs}_${s.patronHistory!.length + 1}`,
        planetId,
        accountId: winner.accountId,
        carrierName: localCarrierName(winner.accountId),
        kind: 'seat_overtaken',
        activeStakedNear: fmt6(winner.activeNear),
        previousAccountId: prevId,
        previousStakedNear: fmt6(prevNear),
        payoutUsd: null,
        atMs: nowMs,
      });
    }
    s.patronSeats![planetId] = nextId;
  }
}

/** Records a nomination change in local mode and re-resolves all planet seats immediately. */
export function recordLocalNomination(
  s: LocalSimState,
  planetId: string,
  nowMs: number,
): { readonly isLeadPatron: boolean; readonly leadPatron: PlanetPatronView | null } {
  const anchor = ensurePatronState(s, nowMs);
  if (s.nominatedPlanet !== planetId) {
    s.nominatedPlanet = planetId;
    s.nominatedAtMs = nowMs;
    s.patronHistory!.unshift({
      id: `loc_${nowMs}_${s.patronHistory!.length + 1}`,
      planetId,
      accountId: s.accountId,
      carrierName: localCarrierName(s.accountId),
      kind: 'nominated',
      activeStakedNear: fmt6(totalActive(s)),
      previousAccountId: null,
      previousStakedNear: null,
      payoutUsd: null,
      atMs: nowMs,
    });
  }
  syncLocalPatronSeats(s, nowMs);
  const candidates = candidatesForPlanet(s, planetId, anchor, nowMs);
  const winner = winnerForPlanet(candidates);
  const leadPatron: PlanetPatronView | null = winner
    ? {
        planetId,
        accountId: winner.accountId,
        carrierName: localCarrierName(winner.accountId),
        activeStakedNear: fmt6(winner.activeNear),
        sinceMs: winner.isSelf ? (s.nominatedAtMs ?? nowMs) : (winner.stakedSinceMs ?? anchor),
        protocolFeeShareBp: STAKING_RULES.patronProtocolFeeShareBp,
      }
    : null;
  return { isLeadPatron: winner?.accountId === s.accountId, leadPatron };
}

/** Canonical planets currently led by the local player. */
export function resolveLocalLeadPlanets(s: LocalSimState, nowMs: number): string[] {
  const anchor = ensurePatronState(s, nowMs);
  syncLocalPatronSeats(s, nowMs);
  const out: string[] = [];
  for (const planetId of PATRONAGE_PLANET_IDS) {
    const winner = winnerForPlanet(candidatesForPlanet(s, planetId, anchor, nowMs));
    if (winner?.accountId === s.accountId) out.push(planetId);
  }
  return out;
}

function buildPlanetCompetition(s: LocalSimState, planetId: string, anchor: number, nowMs: number): PlanetPatronCompetitionView {
  const candidates = candidatesForPlanet(s, planetId, anchor, nowMs);
  const winner = winnerForPlanet(candidates);
  const leadPatron: PlanetPatronView | null = winner
    ? {
        planetId,
        accountId: winner.accountId,
        carrierName: localCarrierName(winner.accountId),
        activeStakedNear: fmt6(winner.activeNear),
        sinceMs: winner.isSelf ? (s.nominatedAtMs ?? nowMs) : (winner.stakedSinceMs ?? anchor),
        protocolFeeShareBp: STAKING_RULES.patronProtocolFeeShareBp,
      }
    : null;
  const contenders: PatronContenderRow[] = candidates.map((c, idx) => {
    const isLead = winner !== null && c.accountId === winner.accountId;
    const status: PatronContenderStatus = isLead ? 'lead' : c.activeNear >= PATRON_MIN_NEAR ? 'contender' : 'below_threshold';
    const gap = isLead
      ? 0
      : winner
        ? winner.activeNear > c.activeNear
          ? winner.activeNear - c.activeNear
          : 1
        : Math.max(0, PATRON_MIN_NEAR - c.activeNear);
    return {
      rank: idx + 1,
      accountId: c.accountId,
      carrierName: localCarrierName(c.accountId),
      activeStakedNear: fmt6(c.activeNear),
      tier: stakingTierFor(c.activeNear).id,
      status,
      gapToLeadNear: fmt6(gap),
      stakedSinceMs: c.stakedSinceMs,
      nominatedAtMs: c.nominatedAtMs,
      isSelf: c.isSelf,
    };
  });
  const baseHist: PatronHistoryRow[] = (BASELINES[planetId]?.history ?? []).map((h) => ({
    id: h.id,
    planetId,
    accountId: h.accountId,
    carrierName: localCarrierName(h.accountId),
    kind: h.kind,
    activeStakedNear: fmt6(h.activeNear),
    previousAccountId: h.previousAccountId,
    previousStakedNear: h.previousNear !== null ? fmt6(h.previousNear) : null,
    payoutUsd: h.payoutUsd,
    atMs: Math.max(0, anchor - h.offsetMs),
  }));
  const dynamicHist = (s.patronHistory ?? []).filter((h) => h.planetId === planetId);
  const history = [...dynamicHist, ...baseHist]
    .sort((a, b) => b.atMs - a.atMs || KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind] || b.id.localeCompare(a.id))
    .slice(0, 20);
  return {
    planetId,
    leadPatron,
    stakeToLeadNear: winner ? fmt6(winner.activeNear) : String(PATRON_MIN_NEAR),
    totalContenders: contenders.length,
    contenders,
    history,
  };
}

/** Builds the full 3-world competition & history payload for `/me.html?host=local`. */
export function buildLocalPatronageView(s: LocalSimState, nowMs: number): PlanetaryPatronageView {
  const anchor = ensurePatronState(s, nowMs);
  syncLocalPatronSeats(s, nowMs);
  return {
    nominatedPlanetId: s.nominatedPlanet,
    planets: PATRONAGE_PLANET_IDS.map((planetId) => buildPlanetCompetition(s, planetId, anchor, nowMs)),
  };
}
