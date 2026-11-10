import { ENTITY_STATE } from '../../ecs/columns';
import { rowOf, setField } from '../../ecs/store';
import { fieldSeeds } from '../../grid/flowField';
import { hexDistance, hexIndex } from '../../grid/hex';
import { pathBlockersFor } from '../../grid/pathProfiles';
import type { StepContext } from '../../kernel/context';
import type { PlanetState } from '../../kernel/state';
import { mobileStats, movementProfile, notifyUnitChanged } from '../../units/mobility';
import {
  commitMarch,
  reservedSlotTiles,
  slotDistance,
  slowestSpeed,
  type MarchCommit,
} from '../../units/movement/groupMarch';
import { requestMove } from '../../units/movement/orchestrator';
import { assignSlots, diskPath, seatingPath } from '../../units/movement/slots';
import { readStancesBlob, writeStancesBlob } from '../combat/stanceHelpers';
import { getUnitStanceRecord, orderUnitAttackMove } from '../combat/stances';
import { cancelWorkerJobs } from '../terraform-basic/workJobs';
import { issueUnitCommand } from '../units/registry';
import { resolvePassableRaidApproachTile } from './raidPathing';

interface RaidMember {
  id: number;
  row: number;
  q: number;
  r: number;
}

function collectRaidMembers(state: PlanetState, unitIds: readonly number[], ctx: StepContext): RaidMember[] {
  const cols = state.entities.cols;
  const seen = new Set<number>();
  const out: RaidMember[] = [];
  for (const id of unitIds) {
    if (seen.has(id)) continue;
    const row = rowOf(state.entities, id);
    if (row < 0 || cols.hp[row]! <= 0 || cols.state[row] === ENTITY_STATE.inert) continue;
    if (!mobileStats(cols.kind[row]!, ctx.data)) continue;
    seen.add(id);
    out.push({ id, row, q: cols.q[row]!, r: cols.r[row]! });
  }
  return out;
}

function resolveStandableGroupAnchor(
  state: PlanetState,
  members: readonly RaidMember[],
  goal: { q: number; r: number },
  ctx: StepContext,
): { q: number; r: number } {
  let sumQ = 0;
  let sumR = 0;
  for (const m of members) {
    sumQ += m.q;
    sumR += m.r;
  }
  const originQ = members.length > 0 ? Math.round(sumQ / members.length) : 0;
  const originR = members.length > 0 ? Math.round(sumR / members.length) : 0;
  const base = resolvePassableRaidApproachTile(state, originQ, originR, goal.q, goal.r, ctx.data);
  const profile = movementProfile(state.entities.cols.kind[members[0]!.row]!, ctx.data);
  const blockers = pathBlockersFor(state, profile, -1, ctx.data);
  const idx = hexIndex(state.grid.radius);
  const baseIdx = idx.indexOf(base.q, base.r);
  if (
    baseIdx >= 0 &&
    !(blockers?.goalBlocked(baseIdx) ?? false) &&
    fieldSeeds(state, base.q, base.r, profile, ctx.data).length > 0
  ) {
    return base;
  }

  let bestQ = base.q;
  let bestR = base.r;
  let bestTargetDist = Infinity;
  let bestOriginDist = Infinity;
  for (let dr = -4; dr <= 4; dr++) {
    const dqMin = Math.max(-4, -dr - 4);
    const dqMax = Math.min(4, -dr + 4);
    for (let dq = dqMin; dq <= dqMax; dq++) {
      const cq = goal.q + dq;
      const cr = goal.r + dr;
      const cIdx = idx.indexOf(cq, cr);
      if (cIdx < 0 || (blockers?.goalBlocked(cIdx) ?? false)) continue;
      if (fieldSeeds(state, cq, cr, profile, ctx.data).length === 0) continue;
      const td = hexDistance(goal.q, goal.r, cq, cr);
      const od = hexDistance(originQ, originR, cq, cr);
      if (td < bestTargetDist || (td === bestTargetDist && od < bestOriginDist)) {
        bestTargetDist = td;
        bestOriginDist = od;
        bestQ = cq;
        bestR = cr;
      }
    }
  }
  return { q: bestQ, r: bestR };
}

function buildRaidMarchPlan(
  state: PlanetState,
  members: readonly RaidMember[],
  anchor: { q: number; r: number },
  pace: 'own' | 'together',
  ctx: StepContext,
): { plan: MarchCommit; overflow: number[] } | null {
  const profile = movementProfile(state.entities.cols.kind[members[0]!.row]!, ctx.data);
  const idx = hexIndex(state.grid.radius);
  const seeds = fieldSeeds(state, anchor.q, anchor.r, profile, ctx.data);
  if (seeds.length === 0) return null;

  const taken = reservedSlotTiles(state);
  const blockers = pathBlockersFor(state, profile, -1, ctx.data);
  const blocked = (i: number) => (blockers ? blockers.goalBlocked(i) : false);
  const seedTiles = seeds.map((i) => ({ q: idx.q[i]!, r: idx.r[i]! }));
  const isFree = (q: number, r: number): boolean => {
    const tile = idx.indexOf(q, r);
    if (tile < 0 || taken.has(tile) || blocked(tile)) return false;
    const radius = Math.max(hexDistance(anchor.q, anchor.r, q, r), 1) + 2;
    return seedTiles.some((seed) => diskPath(idx, seed, { q, r }, anchor, radius, blocked) !== null);
  };

  const { slots, overflow } = assignSlots(anchor, members, isFree, {
    maxRing: state.grid.radius,
    inBounds: (q, r) => idx.indexOf(q, r) >= 0,
  });
  if (slots.length === 0) return null;

  const diskRadius = Math.max(slotDistance(anchor, slots), 1);
  const byId = new Map(members.map((m) => [m.id, m]));
  const planned: MarchCommit['slots'] = {};
  const outside: Array<{ q: number; r: number }> = [];
  const reserved: number[] = [];

  for (const slot of slots) {
    const member = byId.get(slot.id)!;
    const tile = idx.indexOf(slot.q, slot.r);
    if (tile >= 0) reserved.push(tile);
    const inside = hexDistance(member.q, member.r, anchor.q, anchor.r) <= diskRadius;
    const local = inside ? seatingPath(idx, member, slot, anchor, diskRadius + 2, blocked) : null;
    planned[String(slot.id)] = { q: slot.q, r: slot.r, ...(local ? { local } : {}) };
    if (!local) outside.push({ q: member.q, r: member.r });
  }

  const speed = pace === 'together' ? slowestSpeed(state, slots.map((s) => s.id), ctx.data) : undefined;
  return {
    plan: {
      anchorQ: anchor.q,
      anchorR: anchor.r,
      pace,
      profile,
      diskRadius,
      ...(speed !== undefined ? { marchSpeed: speed } : {}),
      slots: planned,
      reserved,
      outside,
    },
    overflow,
  };
}

/**
 * Routes a PvP raid group or multi-unit foreign-territory `attackMove` through W07 `moveGroup`
 * flow-field slots (`assignSlots` + `commitMarch`) while setting each unit's `attackMoveGoal`
 * to its assigned slot so units engage spotted hostiles along the route (`W18-30`, `UO-W-08`, D-43).
 */
export function orderRaidGroupFlowMarch(
  state: PlanetState,
  unitIds: readonly number[],
  goal: { q: number; r: number },
  ctx: StepContext,
  pace: 'own' | 'together' = 'together',
): { slotted: Record<number, { q: number; r: number }>; usedFlowField: boolean } {
  const members = collectRaidMembers(state, unitIds, ctx);
  if (members.length === 0) return { slotted: {}, usedFlowField: false };

  if (members.length === 1) {
    const m = members[0]!;
    cancelWorkerJobs(state, m.id, ctx.tick);
    orderUnitAttackMove(state, m.id, goal, ctx);
    return { slotted: { [m.id]: { q: goal.q, r: goal.r } }, usedFlowField: false };
  }

  const anchor = resolveStandableGroupAnchor(state, members, goal, ctx);
  const built = buildRaidMarchPlan(state, members, anchor, pace, ctx);
  if (!built) {
    const fallback: Record<number, { q: number; r: number }> = {};
    for (const m of members) {
      cancelWorkerJobs(state, m.id, ctx.tick);
      orderUnitAttackMove(state, m.id, goal, ctx);
      fallback[m.id] = { q: goal.q, r: goal.r };
    }
    return { slotted: fallback, usedFlowField: false };
  }

  const { plan, overflow } = built;
  const byEntityId = readStancesBlob(state);
  const slotted: Record<number, { q: number; r: number }> = {};

  for (const key of Object.keys(plan.slots)) {
    const id = Number(key);
    const row = rowOf(state.entities, id);
    if (row < 0) {
      delete plan.slots[key];
      continue;
    }
    cancelWorkerJobs(state, id, ctx.tick);
    const slot = plan.slots[key]!;
    const prev = getUnitStanceRecord(state, row);
    byEntityId[id] = {
      ...prev,
      attackMoveGoal: { q: slot.q, r: slot.r },
      explicitTargetId: null,
      targetId: null,
      returningToAnchor: false,
    };
    const code = issueUnitCommand(
      state,
      row,
      { kind: 'move', source: 'auto', q: slot.q, r: slot.r, minDist: 0, maxDist: 0 },
      ctx,
    );
    if (code) {
      delete plan.slots[key];
      continue;
    }
    slotted[id] = { q: slot.q, r: slot.r };
  }
  writeStancesBlob(state, byEntityId, ctx.tick);

  if (Object.keys(plan.slots).length > 0) {
    commitMarch(state, plan, ctx);
    for (const key of Object.keys(plan.slots)) {
      const id = Number(key);
      const row = rowOf(state.entities, id);
      const slot = plan.slots[key]!;
      if (row < 0) continue;
      requestMove(state, row, { q: slot.q, r: slot.r, minDist: 0, maxDist: 0 }, ctx);
      setField(state.entities, row, 'state', ENTITY_STATE.moving, ctx.tick);
      setField(state.entities, row, 'targetQ', slot.q, ctx.tick);
      setField(state.entities, row, 'targetR', slot.r, ctx.tick);
      notifyUnitChanged(state, row, ctx.tick, ctx.data);
    }
  }

  for (const id of overflow) {
    cancelWorkerJobs(state, id, ctx.tick);
    orderUnitAttackMove(state, id, anchor, ctx);
    slotted[id] = { q: anchor.q, r: anchor.r };
  }

  return { slotted, usedFlowField: Object.keys(plan.slots).length > 0 };
}
