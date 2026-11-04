import { defineSystem } from '../../kernel/system';
import { defineSimModule } from '../define';
import { flushPendingRallyMoves } from '../factories-hub/robotics';
import {
  attackMoveHandler,
  attackTargetHandler,
  setRallyHandler,
  setStanceHandler,
} from './handlers';
import { stepProjectileImpacts } from './projectiles';
import { stepCombatStancesAndTurrets } from './stances';
import { updateColonyVisionCache } from './vision';

export * from './aoe';
export * from './damage';
export * from './evasive';
export * from './handlers';
export * from './lasers';
export * from './layers';
export * from './projectiles';
export * from './stances';
export * from './targeting';
export * from './turrets';
export * from './vision';

export const combatSystem = defineSystem({
  id: 'combat.stances',
  slot: 10,
  wave: 'W07',
  run(state, ctx) {
    updateColonyVisionCache(state, ctx.tick, ctx.data);
    flushPendingRallyMoves(state, ctx);
    stepCombatStancesAndTurrets(state, ctx);
    stepProjectileImpacts(state, ctx.tick, ctx);
  },
});

export default defineSimModule({
  id: 'combat',
  wave: 'W07',
  systems: [combatSystem],
  handlers: [setStanceHandler, setRallyHandler, attackMoveHandler, attackTargetHandler],
});
