import { combatApproachBand, footprintAttackRange } from './approachBand';
import { ENTITY_STATE } from '../../ecs/columns';
import { hexDistance } from '../../grid/hex';
import { faceTowards } from '../../units/movement/locomotion';
import { rowOf } from '../../ecs/store';
import type { StepContext } from '../../kernel/context';
import type { PlanetState } from '../../kernel/state';
import { getUnitCommand } from '../../units/book';
import { issueUnitCommand } from '../units/registry';
import { haltCombatUnit, tryFireUnitWeapon, readStancesBlob, writeStancesBlob } from './stanceHelpers';
import { isTargetValidInRange, resolveAttackerWeaponRow } from './targeting';
import {
  firingRangeTargetRow,
  firingRangeBugTargetRow,
  FIRING_RANGE_UNIT_KINDS,
  readFiringRangeMode,
  type FiringRangeMode,
} from './firingRange';

export type FiringRangeBugPolicy = 'attack' | 'hold' | null;

/** `attack` = bugs close and shoot; `hold` = bugs do not attack; `null` = unchanged fauna. */
export function firingRangeBugPolicy(state: PlanetState): FiringRangeBugPolicy {
  const mode = readFiringRangeMode(state);
  if (mode === 'bugs') return 'attack';
  if (mode === 'gallery' || mode === 'turrets' || mode === 'units' || mode === 'robots') return 'hold';
  return null;
}

/**
 * Unit weapons under a firing-range blob. Returns true when normal stance stepping must not run
 * (`turrets` / `bugs` stay silent; `units` fire here).
 */
export function applyFiringRangeUnitGate(state: PlanetState, ctx: StepContext): boolean {
  const mode: FiringRangeMode | null = readFiringRangeMode(state);
  if (mode === 'gallery' || mode === 'units' || mode === 'robots') {
    stepFiringRangeUnits(state, ctx);
    return true;
  }
  return mode === 'turrets' || mode === 'bugs';
}

function freshStance(id: number, q: number, r: number) {
  return {
    entityId: id,
    stance: 'defend',
    anchorQ: q,
    anchorR: r,
    targetId: null,
    attackMoveGoal: null,
    explicitTargetId: null,
    returningToAnchor: false,
  };
}

/** Gallery units fire at their assigned bug through normal weapon helpers, without walking or evasion. */
export function stepFiringRangeUnits(state: PlanetState, ctx: StepContext): void {
  const cols = state.entities.cols;
  const byEntityId = readStancesBlob(state);
  for (let row = 0; row < state.entities.count; row++) {
    if (!FIRING_RANGE_UNIT_KINDS.includes(cols.kind[row]!)) continue;
    if (cols.hp[row]! <= 0) continue;
    const st = cols.state[row]!;
    if (st === ENTITY_STATE.descending || st === ENTITY_STATE.inert || st === ENTITY_STATE.constructing) continue;
    const weaponRow = resolveAttackerWeaponRow(state, row, ctx.data);
    if (!weaponRow) continue;
    const id = cols.id[row]!;
    const bugRow = firingRangeTargetRow(state, id);
    const rec = byEntityId[id] ?? freshStance(id, cols.q[row]!, cols.r[row]!);
    byEntityId[id] = rec;
    if (bugRow < 0) {
      rec.targetId = null;
      continue;
    }
    haltCombatUnit(state, row, ctx.tick, cols.q[bugRow]!, cols.r[bugRow]!, ctx.data);
    rec.targetId = cols.id[bugRow]!;
    if (isTargetValidInRange(state, row, bugRow, { weaponRow, includePassiveFauna: true, data: ctx.data })) {
      tryFireUnitWeapon(state, row, bugRow, weaponRow, rec, ctx);
    }
  }
  writeStancesBlob(state, byEntityId, ctx.tick);
}

/** Walk into the real weapon band; the fauna action clock exclusively owns damage. */
export function orderFiringRangeBug(state: PlanetState, bugRow: number, ctx: StepContext, range = 1): void {
  if (bugRow < 0) return;
  const cols = state.entities.cols;
  const bugId = cols.id[bugRow]!;
  const target = firingRangeBugTargetRow(state, bugId);
  if (target < 0) { releaseFiringRangeBug(state, bugId, ctx); return; }
  const attackRange = footprintAttackRange(range, cols.footprintW[target]);
  const distance = hexDistance(cols.x[bugRow]!, cols.y[bugRow]!, cols.x[target]!, cols.y[target]!);
  const cur = getUnitCommand(state, bugId);
  if (distance <= attackRange + 1e-4) {
    if (cur?.kind === 'move' || cur?.kind === 'attack') issueUnitCommand(state, bugRow, { kind: 'stop', source: 'player' }, ctx);
    faceTowards(state, bugRow, cols.q[target]!, cols.r[target]!, ctx.tick);
    return;
  }
  const maxDist = combatApproachBand(attackRange, 0,
    hexDistance(cols.q[bugRow], cols.r[bugRow], cols.q[target], cols.r[target]),
    hexDistance(cols.x[target], cols.y[target], cols.q[target], cols.r[target])).maxDist;
  if (cur?.kind === 'move' && cur.q === cols.q[target] && cur.r === cols.r[target] && cur.maxDist === maxDist) return;
  issueUnitCommand(state, bugRow, {
    kind: 'move', source: 'player', q: cols.q[target]!, r: cols.r[target]!, minDist: 0, maxDist,
  }, ctx);
}

/** Cancel movement/attack orders so a held gallery bug remains planted. */
export function releaseFiringRangeBug(state: PlanetState, bugId: number, ctx: StepContext): void {
  const row = rowOf(state.entities, bugId);
  if (row < 0) return;
  const cur = getUnitCommand(state, bugId);
  if (cur?.kind === 'attack' || cur?.kind === 'move') {
    issueUnitCommand(state, row, { kind: 'stop', source: 'auto' }, ctx);
  }
}
