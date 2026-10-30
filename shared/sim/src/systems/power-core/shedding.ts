import type { CompiledDataLike } from '../../kernel/config';
import type { PlanetState } from '../../kernel/state';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { setField } from '../../ecs/store';
import { hexDistance } from '../../grid/hex';
import { resolvePowerRow } from './index';

export interface ShedCandidate {
  entityId: number;
  row: number;
  group: number;
  drainPerS: number;
  kind: number;
}

export interface SheddingResult {
  shedEntityIds: number[];
  shedGroupsActive: number[];
  hqFastRechargeShed: boolean;
  remainingDemand: number;
  offlineReasons: Record<number, string>;
}

/** Reads the ordered shed groups (1..4) from `economyT1Basic`. */
export function getOrderedShedGroups(data?: CompiledDataLike): number[] {
  const groups: Array<{ group: number; priority: number }> = [];
  for (const id of ['shedGroup1', 'shedGroup2', 'shedGroup3', 'shedGroup4']) {
    const row = resolvePowerRow(data, 'economyT1Basic', id);
    groups.push({ group: Number(row.group), priority: Number(row.priority ?? row.group) });
  }
  groups.sort((a, b) => a.priority - b.priority);
  return groups.map((g) => g.group);
}

function checkHqFastRechargeCandidate(
  state: PlanetState,
  colonyIndex: number,
  hubAnchors: ReadonlyArray<{ q: number; r: number }>,
  data?: CompiledDataLike,
): { active: boolean; shedGroup: number } {
  const hqRow = resolvePowerRow(data, 'hq', 't1');
  const radius = Number(hqRow.cellFastRechargeRadius ?? 6);
  const shedGroup = Number(hqRow.cellFastRechargeShedGroup ?? 3);
  const e = state.entities, cols = e.cols;

  for (let row = 0; row < e.count; row++) {
    if (cols.owner[row] !== colonyIndex || cols.kind[row] !== ENTITY_KIND.hq || cols.hp[row] <= 0) continue;
    for (const h of hubAnchors) {
      if (hexDistance(cols.q[row], cols.r[row], h.q, h.r) <= radius) {
        return { active: true, shedGroup };
      }
    }
  }
  return { active: false, shedGroup };
}

/**
 * Applies deterministic brownout shedding across groups 1..4 (`colony-economy-and-buildings-spec.md` §2.2):
 * - Restores previously shed (`offlineBrownout`) candidates before re-evaluating this tick's deficit.
 * - Iterates groups 1..4 in priority order; within each group, sheds newest (`entityId` descending) first
 *   until `remainingDemand <= availableSupply`.
 * - Marks shed entities with `ENTITY_STATE.offlineBrownout` and records `'offline: brownout'` reason.
 * - Suspends HQ fast-recharge when group 3 is shed.
 */
export function applyBrownoutShedding(
  state: PlanetState,
  colonyIndex: number,
  availableSupply: number,
  initialDemand: number,
  candidates: readonly ShedCandidate[],
  hubAnchors: ReadonlyArray<{ q: number; r: number }>,
  tick: number,
  data?: CompiledDataLike,
): SheddingResult {
  const e = state.entities;
  const cols = e.cols;
  const orderedGroups = getOrderedShedGroups(data);
  const hqFast = checkHqFastRechargeCandidate(state, colonyIndex, hubAnchors, data);

  // First, restore any candidate that was in offlineBrownout so we evaluate fresh against current supply
  for (const c of candidates) {
    if (cols.state[c.row] === ENTITY_STATE.offlineBrownout) {
      setField(e, c.row, 'state', ENTITY_STATE.active, tick);
    }
  }

  let remainingDemand = initialDemand;
  const shedEntityIds: number[] = [];
  const shedGroupsSet = new Set<number>();
  const offlineReasons: Record<number, string> = {};
  let hqFastRechargeShed = false;

  if (remainingDemand <= availableSupply + 1e-6) {
    return { shedEntityIds, shedGroupsActive: [], hqFastRechargeShed: false, remainingDemand, offlineReasons };
  }

  for (const group of orderedGroups) {
    if (remainingDemand <= availableSupply + 1e-6) break;

    if (group === hqFast.shedGroup && hqFast.active) {
      hqFastRechargeShed = true;
      shedGroupsSet.add(group);
    }

    const inGroup = candidates
      .filter((c) => c.group === group)
      .sort((a, b) => b.entityId - a.entityId); // newest (entityId descending) first

    for (const c of inGroup) {
      if (remainingDemand <= availableSupply + 1e-6) break;
      setField(e, c.row, 'state', ENTITY_STATE.offlineBrownout, tick);
      remainingDemand = Math.max(0, Number((remainingDemand - c.drainPerS).toFixed(4)));
      shedEntityIds.push(c.entityId);
      shedGroupsSet.add(group);
      offlineReasons[c.entityId] = 'offline: brownout';
    }
  }

  return {
    shedEntityIds,
    shedGroupsActive: [...shedGroupsSet].sort((a, b) => a - b),
    hqFastRechargeShed,
    remainingDemand,
    offlineReasons,
  };
}
