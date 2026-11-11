import { rowOf } from '../../ecs/store';
import { hexDistance } from '../../grid/hex';
import type { StepContext } from '../../kernel/context';
import type { PlanetState } from '../../kernel/state';
import { defineSystem } from '../../kernel/system';
import { getUnitRecord } from '../../units/book';
import { applyDamage } from '../combat/damage';
import { colonyWho } from '../find';
import { issueUnitCommand } from '../units/registry';
import { readMercenary, writeMercenary, type MercenaryContract, type MercenaryLeave } from './blob';

/** After combat and beside bounty presence: hold the area, then leave at `endTick` or when none remain. */
export const mercenarySquadSystem = defineSystem({
  id: 'mercenary.squad',
  slot: 11,
  wave: 'W22',
  run: stepMercenarySquads,
});

function stepMercenarySquads(state: PlanetState, ctx: StepContext): void {
  const blob = readMercenary(state);
  if (!blob.contracts.some((contract) => !contract.left)) return;
  let changed = false;
  for (const contract of blob.contracts) {
    if (contract.left) continue;
    if (tickContract(state, ctx, contract)) changed = true;
  }
  if (changed) writeMercenary(state, blob, ctx.tick);
}

function tickContract(state: PlanetState, ctx: StepContext, contract: MercenaryContract): boolean {
  const living = livingIds(state, contract.entityIds);
  if (living.length === 0) {
    leave(state, ctx, contract, 'wiped');
    return true;
  }
  if (ctx.tick >= contract.endTick) {
    for (const id of living) destroyMerc(state, ctx, id);
    leave(state, ctx, contract, 'ended');
    return true;
  }
  for (const id of living) pullInside(state, ctx, id, contract);
  return false;
}

function livingIds(state: PlanetState, entityIds: readonly number[]): number[] {
  const cols = state.entities.cols;
  const out: number[] = [];
  for (const id of entityIds) {
    const row = rowOf(state.entities, id);
    if (row >= 0 && cols.hp[row]! > 0) out.push(id);
  }
  return out;
}

function sameGoal(current: { q: number; r: number; maxDist?: number }, contract: MercenaryContract): boolean {
  return current.q === contract.q && current.r === contract.r && (current.maxDist ?? 0) === contract.radius;
}

function pullInside(state: PlanetState, ctx: StepContext, id: number, contract: MercenaryContract): void {
  const row = rowOf(state.entities, id);
  if (row < 0) return;
  const cols = state.entities.cols;
  if (hexDistance(cols.q[row]!, cols.r[row]!, contract.q, contract.r) <= contract.radius) return;
  const current = getUnitRecord(state, id)?.current;
  if (current?.kind === 'move' && sameGoal(current, contract)) return;
  issueUnitCommand(state, row, {
    kind: 'move',
    source: 'auto',
    q: contract.q,
    r: contract.r,
    minDist: 0,
    maxDist: contract.radius,
  }, ctx);
}

/** Death path (`applyDamage` → remove) without a step ctx, so this is not a poster `unitDestroyed`. */
function destroyMerc(state: PlanetState, ctx: StepContext, id: number): void {
  const row = rowOf(state.entities, id);
  if (row < 0) return;
  const hp = state.entities.cols.hp[row]!;
  applyDamage(state, id, hp > 0 ? hp : 1, { tick: ctx.tick, data: ctx.data });
}

function leave(state: PlanetState, ctx: StepContext, contract: MercenaryContract, reason: MercenaryLeave): void {
  contract.left = reason;
  ctx.emit({
    kind: 'mercenaryLeft',
    colonyIds: [colonyWho(state, contract.poster).colonyIdStr],
    data: { bountyId: contract.id, rosterId: contract.rosterId, reason },
  });
}
