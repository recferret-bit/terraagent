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
import type { PlanetState } from '../../kernel/state';
import { ensureColonyRecord } from '../../kernel/colonies';
import { getColonyStock } from '../../economy/store';
import { getColonyHqTier } from '../goals/store';

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
    const threatScore = col.threatScore ?? 0;
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
    diplomacy: opts?.diplomacy ? [...opts.diplomacy].slice(0, 12) : [],
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
