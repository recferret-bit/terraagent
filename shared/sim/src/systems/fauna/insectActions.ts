import { rowOf } from '../../ecs/store';
import { setBlob, type PlanetState } from '../../kernel/state';
import type { FaunaSpeciesId } from './types';

export const INSECT_ACTIONS_BLOB = 'insectActions';
export type InsectActionState = 'idle' | 'moving' | 'windup' | 'attack' | 'recovery';
export interface InsectActionRecord {
  state: InsectActionState;
  startedTick: number;
  durationTicks: number;
  targetId: number | null;
}
export interface InsectActionsBlob { byEntityId: Record<number, InsectActionRecord> }
export const INSECT_WINDUP_TICKS: Readonly<Record<FaunaSpeciesId, number>> = {
  blackAnt: 2, blueBeetle: 3, greenSpitter: 3,
};

export function readInsectActions(state: PlanetState): InsectActionsBlob {
  return state.blobs[INSECT_ACTIONS_BLOB]?.value as InsectActionsBlob | undefined ?? { byEntityId: {} };
}

interface AdvanceInput {
  tick: number; species: FaunaSpeciesId; intervalTicks: number; lastAttackTick: number;
  moving: boolean; targetId: number | null;
}
function record(state: InsectActionState, input: AdvanceInput, durationTicks = 0): InsectActionRecord {
  return { state, startedTick: input.tick, durationTicks, targetId: input.targetId };
}

/** Pure shared attack clock. Only `release` authorizes a bite or projectile. */
export function advanceInsectAction(previous: InsectActionRecord | undefined, input: AdvanceInput): {
  action: InsectActionRecord; release: boolean;
} {
  const windup = INSECT_WINDUP_TICKS[input.species];
  if (input.targetId === null) {
    const state = input.moving ? 'moving' : 'idle';
    return { action: previous?.state === state && previous.targetId === null ? previous : record(state, input), release: false };
  }
  if (previous?.targetId === input.targetId) {
    const elapsed = input.tick - previous.startedTick;
    if (previous.state === 'windup') {
      return elapsed >= previous.durationTicks
        ? { action: record('attack', input, 1), release: true }
        : { action: previous, release: false };
    }
    if (previous.state === 'attack' && elapsed < previous.durationTicks) return { action: previous, release: false };
    if (previous.state === 'attack') {
      const duration = Math.max(1, input.intervalTicks - windup - 1);
      return { action: record('recovery', input, duration), release: false };
    }
    if (previous.state === 'recovery' && elapsed < previous.durationTicks) return { action: previous, release: false };
  }
  const untilWindup = input.lastAttackTick + input.intervalTicks - windup - input.tick;
  if (untilWindup > 0) return { action: record('recovery', input, untilWindup), release: false };
  return { action: record('windup', input, windup), release: false };
}

/** Active action clocks only: idle/moving already replicate in ECS, so never duplicate them in this blob. */
export class InsectActionBook {
  private readonly byEntityId: Record<number, InsectActionRecord>;
  private changed = false;
  constructor(private readonly state: PlanetState) {
    this.byEntityId = { ...readInsectActions(state).byEntityId };
  }
  advance(entityId: number, input: AdvanceInput): boolean {
    const previous = this.byEntityId[entityId];
    const { action, release } = advanceInsectAction(previous, input);
    if (action.state === 'idle' || action.state === 'moving') {
      if (previous) { delete this.byEntityId[entityId]; this.changed = true; }
    } else if (previous !== action) {
      this.byEntityId[entityId] = action; this.changed = true;
    }
    return release;
  }
  flush(tick: number): void {
    for (const key of Object.keys(this.byEntityId)) {
      const row = rowOf(this.state.entities, Number(key));
      if (row >= 0 && this.state.entities.cols.hp[row]! > 0) continue;
      delete this.byEntityId[Number(key)]; this.changed = true;
    }
    if (this.changed) setBlob(this.state, INSECT_ACTIONS_BLOB, { byEntityId: this.byEntityId }, tick);
  }
}
