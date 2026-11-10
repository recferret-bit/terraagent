import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { rowOf } from '../../ecs/store';
import { hexDistance, hexIndex } from '../../grid/hex';
import { pathBlockersFor } from '../../grid/pathProfiles';
import { isGroundPassable, isTileExplored } from '../../grid/tileModel';
import type { CompiledDataLike } from '../../kernel/config';
import type { StepContext } from '../../kernel/context';
import type { PlanetState } from '../../kernel/state';
import { isTargetSpottedByColony, updateColonyVisionCache } from '../combat/vision';
import { hasActiveTruce, resolveColonyIdStr } from '../diplomacy/store';
import { orderRaidGroupFlowMarch } from './raidFlowMarch';
import { getPvpState, savePvpState, type ActiveRaidGroupState } from './store';

export interface RaidTargetSelection {
  q: number;
  r: number;
  targetEntityId: number | null;
  priority: number;
  spotted: boolean;
}

/**
 * Target priority for raid pathing (`W18-04`, `UO-W-08`):
 * - `0`: Frontier defenses (`autocannon`, `laserTower`)
 * - `1`: Resource & command hubs (`supplyDepot`, `commandHub`, `hub`, `hq`)
 * - `2`: Other colony structures (`solar`, `metalsExtractor`, `roboticsFactory`, etc.)
 * - `3`: Mobile enemy units
 */
export function raidTargetPriorityForKind(kind: number): number {
  if (kind === ENTITY_KIND.autocannon || kind === ENTITY_KIND.laserTower) return 0;
  if (
    kind === ENTITY_KIND.supplyDepot ||
    kind === ENTITY_KIND.commandHub ||
    kind === ENTITY_KIND.hub ||
    kind === ENTITY_KIND.hq
  ) {
    return 1;
  }
  if (
    kind === ENTITY_KIND.worker ||
    kind === ENTITY_KIND.recon ||
    kind === ENTITY_KIND.demoTank ||
    kind === ENTITY_KIND.demoArtillery
  ) {
    return 3;
  }
  return 2;
}

/**
 * Dormant W14 gate-pathing hook (`W18-04`): while `W14` (walls & gates) is postponed in the Tier-1 slice,
 * returns `(targetQ, targetR)` unchanged.
 */
export function resolveDormantGateBypassTile(
  _state: PlanetState,
  targetQ: number,
  targetR: number,
): { q: number; r: number } {
  return { q: targetQ, r: targetR };
}

/**
 * Ensures the raid destination tile `(q, r)` is on a passable ground hex around a structure/obstacle.
 * If `(targetQ, targetR)` is impassable terrain (e.g. deep water / canyon), picks the closest passable neighbor.
 */
export function resolvePassableRaidApproachTile(
  state: PlanetState,
  originQ: number,
  originR: number,
  targetQ: number,
  targetR: number,
  data?: CompiledDataLike,
): { q: number; r: number } {
  const gated = resolveDormantGateBypassTile(state, targetQ, targetR);
  const idx = hexIndex(state.grid.radius);
  const centerIdx = idx.indexOf(gated.q, gated.r);
  if (centerIdx >= 0 && isGroundPassable(state.grid, centerIdx, data)) {
    return gated;
  }
  const blockers = pathBlockersFor(state, 'ground', -1, data);
  let bestQ = gated.q;
  let bestR = gated.r;
  let bestDist = Infinity;
  let bestTargetDist = Infinity;
  for (let dr = -3; dr <= 3; dr++) {
    const dqMin = Math.max(-3, -dr - 3);
    const dqMax = Math.min(3, -dr + 3);
    for (let dq = dqMin; dq <= dqMax; dq++) {
      if (dq === 0 && dr === 0) continue;
      const nq = gated.q + dq;
      const nr = gated.r + dr;
      const nIdx = idx.indexOf(nq, nr);
      if (nIdx < 0 || !isGroundPassable(state.grid, nIdx, data)) continue;
      if (blockers?.blocked(nIdx)) continue;
      const td = hexDistance(gated.q, gated.r, nq, nr);
      const d = hexDistance(originQ, originR, nq, nr);
      if (td < bestTargetDist || (td === bestTargetDist && d < bestDist)) {
        bestTargetDist = td;
        bestDist = d;
        bestQ = nq;
        bestR = nr;
      }
    }
  }
  return { q: bestQ, r: bestR };
}

function isEntitySpottedOrExplored(
  state: PlanetState,
  attackerColony: number,
  targetRow: number,
  data?: CompiledDataLike,
): boolean {
  if (isTargetSpottedByColony(state, attackerColony, targetRow, data)) return true;
  const cols = state.entities.cols;
  const tileIdx = hexIndex(state.grid.radius).indexOf(cols.q[targetRow]!, cols.r[targetRow]!);
  if (tileIdx >= 0 && isTileExplored(state.grid, tileIdx, attackerColony)) return true;
  return false;
}

function findNearestOwnedFrontierTile(
  state: PlanetState,
  targetColony: number,
  originQ: number,
  originR: number,
  data?: CompiledDataLike,
): { q: number; r: number } | null {
  const ownerLayer = state.grid.layers.owner;
  if (!ownerLayer) return null;
  const idx = hexIndex(state.grid.radius);
  let bestTile = -1;
  let bestDist = Infinity;
  for (let i = 0; i < idx.count; i++) {
    if (ownerLayer[i] !== targetColony) continue;
    if (!isGroundPassable(state.grid, i, data)) continue;
    const d = hexDistance(originQ, originR, idx.q[i]!, idx.r[i]!);
    if (d < bestDist) {
      bestDist = d;
      bestTile = i;
    }
  }
  if (bestTile < 0) return null;
  return { q: idx.q[bestTile]!, r: idx.r[bestTile]! };
}

function scanTargetColonyEntities(
  state: PlanetState,
  attackerColony: number,
  targetColony: number,
  originQ: number,
  originR: number,
  data?: CompiledDataLike,
): { bestSpottedRow: number; bestSpottedPrio: number; bestAnyRow: number; bestAnyPrio: number } {
  const cols = state.entities.cols;
  let bestSpottedRow = -1;
  let bestSpottedPrio = Infinity;
  let bestSpottedDist = Infinity;
  let bestSpottedId = Infinity;
  let bestAnyRow = -1;
  let bestAnyPrio = Infinity;
  let bestAnyDist = Infinity;
  let bestAnyId = Infinity;

  for (let r = 0; r < state.entities.count; r++) {
    if (cols.owner[r] !== targetColony || cols.hp[r]! <= 0) continue;
    const st = cols.state[r]!;
    if (st === ENTITY_STATE.inert || st === ENTITY_STATE.descending) continue;
    const prio = raidTargetPriorityForKind(cols.kind[r]!);
    const dist = hexDistance(originQ, originR, cols.q[r]!, cols.r[r]!);
    const id = cols.id[r]!;

    if (
      prio < bestAnyPrio ||
      (prio === bestAnyPrio && (dist < bestAnyDist || (dist === bestAnyDist && id < bestAnyId)))
    ) {
      bestAnyPrio = prio;
      bestAnyDist = dist;
      bestAnyId = id;
      bestAnyRow = r;
    }

    if (
      isEntitySpottedOrExplored(state, attackerColony, r, data) &&
      (prio < bestSpottedPrio ||
        (prio === bestSpottedPrio &&
          (dist < bestSpottedDist || (dist === bestSpottedDist && id < bestSpottedId))))
    ) {
      bestSpottedPrio = prio;
      bestSpottedDist = dist;
      bestSpottedId = id;
      bestSpottedRow = r;
    }
  }
  return { bestSpottedRow, bestSpottedPrio, bestAnyRow, bestAnyPrio };
}

/**
 * Selects the best raid target in `targetColony` for `attackerColony` from `(originQ, originR)` (`W18-04`, `UO-W-08`):
 * 1. Prioritizes spotted/explored enemy structures in order: frontier defenses (`0`) -> Depots/Hub/HQ (`1`) -> other structures (`2`) -> units (`3`).
 * 2. If no enemy structure is currently spotted/explored and `targetColony` owns frontier territory tiles, paths to the nearest frontier tile until vision spots structures.
 * 3. Falls back to the highest-priority living structure of `targetColony` when no territory tiles are painted.
 */
export function selectSpottedRaidTarget(
  state: PlanetState,
  attackerColony: number,
  targetColony: number,
  originQ: number,
  originR: number,
  opts?: { data?: CompiledDataLike; requireSpotted?: boolean },
): RaidTargetSelection {
  const cols = state.entities.cols;
  const { bestSpottedRow, bestSpottedPrio, bestAnyRow, bestAnyPrio } = scanTargetColonyEntities(
    state,
    attackerColony,
    targetColony,
    originQ,
    originR,
    opts?.data,
  );

  if (bestSpottedRow >= 0) {
    const approach = resolvePassableRaidApproachTile(
      state,
      originQ,
      originR,
      cols.q[bestSpottedRow]!,
      cols.r[bestSpottedRow]!,
      opts?.data,
    );
    return {
      q: approach.q,
      r: approach.r,
      targetEntityId: cols.id[bestSpottedRow]!,
      priority: bestSpottedPrio,
      spotted: true,
    };
  }

  const frontierTile = findNearestOwnedFrontierTile(state, targetColony, originQ, originR, opts?.data);
  if (frontierTile && opts?.requireSpotted !== false) {
    return {
      q: frontierTile.q,
      r: frontierTile.r,
      targetEntityId: null,
      priority: 1,
      spotted: false,
    };
  }

  if (bestAnyRow >= 0) {
    const approach = resolvePassableRaidApproachTile(
      state,
      originQ,
      originR,
      cols.q[bestAnyRow]!,
      cols.r[bestAnyRow]!,
      opts?.data,
    );
    return {
      q: approach.q,
      r: approach.r,
      targetEntityId: cols.id[bestAnyRow]!,
      priority: bestAnyPrio,
      spotted: false,
    };
  }

  if (frontierTile) {
    return {
      q: frontierTile.q,
      r: frontierTile.r,
      targetEntityId: null,
      priority: 2,
      spotted: false,
    };
  }

  return { q: 0, r: 0, targetEntityId: null, priority: 3, spotted: false };
}

function computeLivingRaidersOrigin(
  state: PlanetState,
  unitIds: readonly number[],
): { q: number; r: number; livingIds: number[] } {
  const cols = state.entities.cols;
  const livingIds: number[] = [];
  let sumQ = 0;
  let sumR = 0;
  for (const id of unitIds) {
    const row = rowOf(state.entities, id);
    if (row >= 0 && cols.hp[row]! > 0 && cols.state[row] !== ENTITY_STATE.inert) {
      livingIds.push(id);
      sumQ += cols.q[row]!;
      sumR += cols.r[row]!;
    }
  }
  if (livingIds.length === 0) return { q: 0, r: 0, livingIds };
  return {
    q: Math.round(sumQ / livingIds.length),
    r: Math.round(sumR / livingIds.length),
    livingIds,
  };
}

function advanceSingleActiveRaid(
  state: PlanetState,
  raid: ActiveRaidGroupState,
  ctx: StepContext,
): boolean {
  const { q: originQ, r: originR, livingIds } = computeLivingRaidersOrigin(state, raid.unitIds);
  const truceActive = hasActiveTruce(state, raid.attackerColony, raid.targetColony, ctx.tick);

  if (livingIds.length === 0 || truceActive) {
    raid.unitIds = livingIds;
    raid.repelled = true;
    const fromId = resolveColonyIdStr(state, raid.attackerColony);
    const toId = resolveColonyIdStr(state, raid.targetColony);
    ctx.emit({
      kind: 'raidRepelled',
      severity: 'info',
      colonyIds: [fromId, toId],
      data: {
        raidId: raid.raidId,
        attackerColony: raid.attackerColony,
        targetColony: raid.targetColony,
        fromColony: fromId,
        toColony: toId,
      },
    });
    return false;
  }

  raid.unitIds = livingIds;
  const curTargetRow =
    raid.currentTargetEntityId !== null ? rowOf(state.entities, raid.currentTargetEntityId) : -1;
  const curTargetAlive =
    curTargetRow >= 0 &&
    state.entities.cols.hp[curTargetRow]! > 0 &&
    state.entities.cols.owner[curTargetRow] === raid.targetColony;
  const curPrio = curTargetAlive
    ? raidTargetPriorityForKind(state.entities.cols.kind[curTargetRow]!)
    : Infinity;

  const next = selectSpottedRaidTarget(
    state,
    raid.attackerColony,
    raid.targetColony,
    originQ,
    originR,
    { data: ctx.data },
  );

  const shouldRetarget =
    !curTargetAlive ||
    (raid.currentTargetEntityId === null && next.targetEntityId !== null) ||
    (next.spotted && next.priority < curPrio);

  if (
    shouldRetarget &&
    (next.targetEntityId !== raid.currentTargetEntityId ||
      next.q !== raid.currentTargetQ ||
      next.r !== raid.currentTargetR)
  ) {
    raid.currentTargetEntityId = next.targetEntityId;
    raid.currentTargetQ = next.q;
    raid.currentTargetR = next.r;
    orderRaidGroupFlowMarch(state, livingIds, { q: next.q, r: next.r }, ctx, 'together');
  }
  return true;
}

/**
 * Steps all active PvP raid groups (`W18-04`):
 * - Refreshes colony vision so advancing raiders spot frontier defenses and interior depots/hubs.
 * - Retargets raiders from destroyed frontier defenses to newly spotted Depots/Hub.
 * - Emits `raidRepelled` when all raiders of an active raid are eliminated or a truce stops the raid.
 */
export function stepActiveRaids(state: PlanetState, ctx: StepContext): void {
  const pvpState = getPvpState(state);
  const raidIds = Object.keys(pvpState.activeRaids);
  if (raidIds.length === 0) return;

  updateColonyVisionCache(state, ctx.tick, ctx.data, true);
  let changed = false;
  for (const raidId of raidIds) {
    const raid = pvpState.activeRaids[raidId];
    if (!raid || raid.repelled) {
      delete pvpState.activeRaids[raidId];
      changed = true;
      continue;
    }
    const prevTargetId = raid.currentTargetEntityId;
    const prevQ = raid.currentTargetQ;
    const prevR = raid.currentTargetR;
    const prevCount = raid.unitIds.length;
    const keep = advanceSingleActiveRaid(state, raid, ctx);
    if (!keep) {
      delete pvpState.activeRaids[raidId];
      changed = true;
    } else if (
      raid.currentTargetEntityId !== prevTargetId ||
      raid.currentTargetQ !== prevQ ||
      raid.currentTargetR !== prevR ||
      raid.unitIds.length !== prevCount
    ) {
      changed = true;
    }
  }
  if (changed) {
    savePvpState(state, pvpState, ctx.tick);
  }
}
