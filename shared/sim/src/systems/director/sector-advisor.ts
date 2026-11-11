import {
  SectorAdvisorBriefSchema,
  type SectorAdvisorBrief,
  type SectorAdvisorDirective,
  type SectorColonySnap,
  type SectorDiplomacySnap,
  type SectorDisasterSnap,
  type SectorFaunaSnap,
  type SectorMarketSnap,
} from '@terra/contracts';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { hexDistance } from '../../grid/hex';
import type { PlanetState } from '../../kernel/state';
import { ensureColonyRecord } from '../../kernel/colonies';
import { getColonyStock } from '../../economy/store';
import {
  hasActiveTruce,
  pairKey,
  readDiplomacyBlob,
  resolveColonyIdStr,
} from '../diplomacy/store';
import { getColonyHqTier } from '../goals/store';
import { getPvpState } from '../pvp/store';
import { isColonyRaidProtected } from '../pvp/shield';

export interface SectorCadenceCheck {
  readonly shouldRun: boolean;
  readonly reason: 'cadence_elapsed' | 'critical_disaster' | 'critical_threat' | 'cooldown_active';
  readonly nextRunSimS: number;
}

export function shouldRunSectorAdvisor(
  lastRunSimS: number,
  currentSimS: number,
  hasCriticalThreat: boolean,
  baseCadenceS = 300,
  criticalCadenceS = 120,
): SectorCadenceCheck {
  const cadence = hasCriticalThreat ? criticalCadenceS : baseCadenceS;
  const elapsed = currentSimS - lastRunSimS;
  if (elapsed < cadence) {
    return { shouldRun: false, reason: 'cooldown_active', nextRunSimS: lastRunSimS + cadence };
  }
  if (hasCriticalThreat) {
    return { shouldRun: true, reason: 'critical_threat', nextRunSimS: currentSimS + cadence };
  }
  return { shouldRun: true, reason: 'cadence_elapsed', nextRunSimS: currentSimS + cadence };
}

export interface SectorColonyMeta {
  isOffline?: boolean;
  threatScore?: number;
  powerDeficit?: boolean;
  stewardshipAction?: string;
  stewardshipPriorityGoal?: string;
}

function findColonyHubCoords(state: PlanetState, colonyIndex: number): { q: number; r: number } | null {
  const cols = state.entities.cols;
  for (let r = 0; r < state.entities.count; r++) {
    if (cols.owner[r] !== colonyIndex || cols.hp[r]! <= 0) continue;
    const st = cols.state[r]!;
    if (st === ENTITY_STATE.inert || st === ENTITY_STATE.descending) continue;
    const k = cols.kind[r]!;
    if (k === ENTITY_KIND.hq || k === ENTITY_KIND.hub || k === ENTITY_KIND.commandHub) {
      return { q: cols.q[r]!, r: cols.r[r]! };
    }
  }

  for (let r = 0; r < state.entities.count; r++) {
    if (cols.owner[r] !== colonyIndex || cols.hp[r]! <= 0) continue;
    const st = cols.state[r]!;
    if (st === ENTITY_STATE.inert || st === ENTITY_STATE.descending) continue;
    const k = cols.kind[r]!;
    if (k === ENTITY_KIND.dropPod || k === ENTITY_KIND.pod) {
      return { q: cols.q[r]!, r: cols.r[r]! };
    }
  }

  const col = state.colonies[colonyIndex];
  if (col) {
    const colAny = col as { q?: number; r?: number };
    if (typeof colAny.q === 'number' && typeof colAny.r === 'number') {
      return { q: colAny.q, r: colAny.r };
    }
  }
  return null;
}

function countHostileCombatUnitsNearHq(
  state: PlanetState,
  colonyIndex: number,
  hq: { q: number; r: number },
  tick: number,
): number {
  const cols = state.entities.cols;
  let count = 0;
  for (let r = 0; r < state.entities.count; r++) {
    if (cols.hp[r]! <= 0) continue;
    const st = cols.state[r]!;
    if (st === ENTITY_STATE.inert || st === ENTITY_STATE.descending) continue;
    const owner = cols.owner[r]!;
    if (owner < 0 || owner === colonyIndex) continue;
    const k = cols.kind[r]!;
    const isCombat =
      k === ENTITY_KIND.recon || k === ENTITY_KIND.demoTank || k === ENTITY_KIND.demoArtillery;
    if (!isCombat) continue;

    if (hasActiveTruce(state, colonyIndex, owner, tick)) continue;

    if (hexDistance(hq.q, hq.r, cols.q[r]!, cols.r[r]!) <= 12) {
      count++;
    }
  }
  return count;
}

function checkActiveIncomingRaid(state: PlanetState, colonyIndex: number): boolean {
  const pvp = getPvpState(state);
  if (Object.values(pvp.activeRaids).some((r) => r && r.targetColony === colonyIndex && !r.repelled)) {
    return true;
  }
  if (Object.values(pvp.byColony).some((c) => c && c.activeRaidTargetColony === colonyIndex)) {
    return true;
  }
  const rawPvp = state.blobs.pvp?.value as { activeRaidsByColony?: Record<number, unknown> } | undefined;
  if (rawPvp?.activeRaidsByColony?.[colonyIndex]) {
    return true;
  }
  return false;
}

export function computeColonyPvpThreatScore(
  state: PlanetState,
  colonyIndex: number,
  tick = state.meta.tick,
): number {
  if (colonyIndex < 0 || colonyIndex >= state.colonies.length) return 0;
  const col = state.colonies[colonyIndex];
  if (!col || col.status === 'eliminated') return 0;
  if (col.status === 'critical') return 100;

  let score = 0;
  if (checkActiveIncomingRaid(state, colonyIndex)) {
    score += 50;
  }

  const hq = findColonyHubCoords(state, colonyIndex);
  if (hq) {
    const hostileUnits = countHostileCombatUnitsNearHq(state, colonyIndex, hq, tick);
    score += Math.min(45, hostileUnits * 15);
  }

  if (isColonyRaidProtected(state, colonyIndex, tick)) {
    score -= 25;
  }

  return Math.max(0, Math.min(100, score));
}

function projectSectorDiplomacy(state: PlanetState): SectorDiplomacySnap[] {
  const blob = readDiplomacyBlob(state);
  const snaps: SectorDiplomacySnap[] = [];
  const seen = new Set<string>();

  for (const t of Object.values(blob.truces)) {
    const isNotice = t.status === 'notice' && (t.noticeEndsAtTick ?? t.expiresAtTick) > state.meta.tick;
    const isActive = t.status === 'active' && t.expiresAtTick > state.meta.tick;
    if (!isActive && !isNotice) continue;
    const aId = resolveColonyIdStr(state, t.colonyAIndex);
    const bId = resolveColonyIdStr(state, t.colonyBIndex);
    const key = pairKey(t.colonyAIndex, t.colonyBIndex);
    seen.add(key);
    snaps.push({
      colonyPair: [aId, bId],
      relation: 'truce',
      borderTension: isNotice ? 50 : 10,
    });
    if (snaps.length >= 12) return snaps;
  }

  for (const [key] of Object.entries(blob.lastHostilityByPair)) {
    if (seen.has(key)) continue;
    const [aIdx, bIdx] = key.split(':').map(Number);
    if (aIdx === undefined || bIdx === undefined || isNaN(aIdx) || isNaN(bIdx)) continue;
    const aId = resolveColonyIdStr(state, aIdx);
    const bId = resolveColonyIdStr(state, bIdx);
    seen.add(key);
    const inTruce = hasActiveTruce(state, aIdx, bIdx, state.meta.tick);
    snaps.push({
      colonyPair: [aId, bId],
      relation: inTruce ? 'truce' : 'hostile',
      borderTension: inTruce ? 10 : 75,
    });
    if (snaps.length >= 12) return snaps;
  }

  for (const [colStr, contacts] of Object.entries(blob.contactsByColony)) {
    const colIdx = Number(colStr);
    for (const otherIdx of contacts) {
      const key = pairKey(colIdx, otherIdx);
      if (seen.has(key)) continue;
      seen.add(key);
      snaps.push({
        colonyPair: [resolveColonyIdStr(state, colIdx), resolveColonyIdStr(state, otherIdx)],
        relation: 'neutral',
        borderTension: 0,
      });
      if (snaps.length >= 12) return snaps;
    }
  }

  return snaps.slice(0, 12);
}

function projectColonies(state: PlanetState, _sectorId: string, simTimeS: number): SectorColonySnap[] {
  if (state.colonies.length === 0) {
    ensureColonyRecord(state, 0, 0);
  }
  const colonies: SectorColonySnap[] = [];
  for (let i = 0; i < state.colonies.length; i++) {
    const col = state.colonies[i] as (typeof state.colonies)[number] & SectorColonyMeta;
    if (!col) continue;
    const stock = getColonyStock(state, i);
    const resources: Record<string, number> = {};
    for (const [k, v] of Object.entries(stock)) {
      if (typeof v === 'number') resources[k] = v;
    }
    const isOffline = col.isOffline ?? false;
    const pvpThreat = computeColonyPvpThreatScore(state, i, state.meta.tick);
    const threatScore = Math.max(col.threatScore ?? 0, pvpThreat);
    const powerDeficit = col.powerDeficit ?? false;

    colonies.push({
      colonyId: col.id ?? `col_${i}`,
      isOffline,
      offlineSinceSimS: isOffline ? Math.max(0, simTimeS - 600) : undefined,
      hqTier: getColonyHqTier(state, i),
      resources,
      powerDeficit,
      threatScore,
      stewardshipMode: isOffline ? 'conservative' : 'balanced',
    });
  }
  return colonies.slice(0, 16);
}

export function buildSectorAdvisorBrief(
  state: PlanetState,
  sectorId: string,
  simTimeS: number,
  cadenceS = 300,
  opts?: {
    readonly fauna?: readonly SectorFaunaSnap[];
    readonly disasters?: readonly SectorDisasterSnap[];
    readonly market?: SectorMarketSnap;
    readonly diplomacy?: readonly SectorDiplomacySnap[];
  },
): SectorAdvisorBrief {
  const colonies = projectColonies(state, sectorId, simTimeS);
  const brief: SectorAdvisorBrief = {
    version: 1,
    sectorId,
    planetId: state.meta.planetId,
    simTimeS,
    cadenceS,
    colonies,
    fauna: opts?.fauna ? [...opts.fauna].slice(0, 8) : [],
    disasters: opts?.disasters ? [...opts.disasters].slice(0, 4) : [],
    market: opts?.market ?? { activeTradeRoutes: 0 },
    diplomacy: opts?.diplomacy ? [...opts.diplomacy].slice(0, 12) : projectSectorDiplomacy(state),
  };
  return SectorAdvisorBriefSchema.parse(brief);
}

export interface AppliedSectorDirectives {
  readonly sectorId: string;
  readonly coloniesUpdated: number;
  readonly shelterActive: boolean;
  readonly threatLevel: string;
}

export function applySectorDirectives(
  state: PlanetState,
  directive: SectorAdvisorDirective,
): AppliedSectorDirectives {
  let updated = 0;
  for (const st of directive.stewardshipDirectives) {
    let col = state.colonies.find((c) => c?.id === st.colonyId);
    if (!col && (st.colonyId === 'col_0' || state.colonies.length === 0)) {
      col = ensureColonyRecord(state, 0, 0);
    }
    if (col) {
      const meta = col as typeof col & SectorColonyMeta;
      meta.stewardshipAction = st.action;
      meta.stewardshipPriorityGoal = st.priorityGoal;
      updated++;
    }
  }
  return {
    sectorId: directive.sectorId,
    coloniesUpdated: updated,
    shelterActive: directive.disasterAdvisory.shelterProtocol,
    threatLevel: directive.faunaManagement.threatLevel,
  };
}
