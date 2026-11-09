import { rowOf } from '../../ecs/store';
import { setBlob, type PlanetState } from '../../kernel/state';

export const BATTLE_BLOB = 'battle';
export interface CombatantState {
  targetId: number | null;
}
export interface BattleState { byEntityId: Record<number, CombatantState> }

export function readBattleState(state: PlanetState): BattleState {
  return (state.blobs[BATTLE_BLOB]?.value as BattleState | undefined) ?? { byEntityId: {} };
}

/** Shared base for units, defenses and fauna. Only plain records enter snapshots/replays. */
export class Combatant {
  constructor(private state: PlanetState, readonly entityId: number) {}

  get current(): CombatantState {
    return readBattleState(this.state).byEntityId[this.entityId] ?? {
      targetId: null,
    };
  }

  target(targetId: number | null, tick: number): void {
    const cols = this.state.entities.cols;
    const row = rowOf(this.state.entities, this.entityId);
    const targetRow = targetId === null ? -1 : rowOf(this.state.entities, targetId);
    const previous = this.current;
    const record = { ...previous, targetId: null as number | null };
    if (row >= 0 && targetRow >= 0 && cols.hp[row]! > 0 && cols.hp[targetRow]! > 0) {
      record.targetId = targetId;
    }
    if (previous.targetId === record.targetId) return;
    setBlob(this.state, BATTLE_BLOB, {
      byEntityId: { ...readBattleState(this.state).byEntityId, [this.entityId]: record },
    }, tick);
  }
}
