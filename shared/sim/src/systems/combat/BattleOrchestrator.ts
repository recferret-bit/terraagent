import { rowOf } from '../../ecs/store';
import type { StepContext } from '../../kernel/context';
import { setBlob, type PlanetState } from '../../kernel/state';
import { flushPendingRallyMoves } from '../factories-hub/robotics';
import { stepFaunaCombat } from '../fauna/step';
import { BATTLE_BLOB, Combatant, readBattleState } from './Combatant';
import { stepProjectileImpacts } from './projectiles';
import { readStancesBlob } from './stanceHelpers';
import { stepCombatStancesAndTurrets } from './stances';
import { COMBAT_TURRETS_BLOB, type CombatTurretsBlob } from './turrets';
import { updateColonyVisionCache } from './vision';

/** One deterministic combat tick for the server, local host, prediction and playground. */
export class BattleOrchestrator {
  step(state: PlanetState, ctx: StepContext): void {
    updateColonyVisionCache(state, ctx.tick, ctx.data);
    flushPendingRallyMoves(state, ctx);
    stepCombatStancesAndTurrets(state, ctx);
    // Preserve the prior slot order: arrivals can kill a bug before its attack decision.
    stepProjectileImpacts(state, ctx.tick, ctx);
    stepFaunaCombat(state, ctx);
    this.syncTargets(state, ctx.tick);
  }

  private syncTargets(state: PlanetState, tick: number): void {
    const turrets = state.blobs[COMBAT_TURRETS_BLOB]?.value as CombatTurretsBlob | undefined;
    const selected = { ...readStancesBlob(state), ...turrets?.byEntityId };
    for (const record of Object.values(selected)) {
      new Combatant(state, record.entityId).target(record.targetId ?? null, tick);
    }
    const byEntityId = { ...readBattleState(state).byEntityId };
    let changed = false;
    for (const [key, record] of Object.entries(byEntityId)) {
      const row = rowOf(state.entities, Number(key));
      if (row < 0 || state.entities.cols.hp[row]! <= 0) { delete byEntityId[Number(key)]; changed = true; continue; }
      const targetRow = record.targetId === null ? -1 : rowOf(state.entities, record.targetId);
      if (record.targetId !== null && (targetRow < 0 || state.entities.cols.hp[targetRow]! <= 0)) {
        byEntityId[Number(key)] = { ...record, targetId: null };
        changed = true;
      }
    }
    if (changed) setBlob(state, BATTLE_BLOB, { byEntityId }, tick);
  }
}
export const battleOrchestrator = new BattleOrchestrator();
