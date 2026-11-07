import { defineSystem } from '../../kernel/system';
import { defineSimModule } from '../define';
import { battleOrchestrator } from './BattleOrchestrator';
import {
  attackMoveHandler,
  attackTargetHandler,
  setRallyHandler,
  setStanceHandler,
} from './handlers';
export * from './Combatant';
export * from './BattleOrchestrator';

export * from './aoe';
export * from './approachBand';
export * from './damage';
export * from './firingRange';
export * from './galleryFixture';
export * from './insectFixture';
export * from './evasive';
export * from './handlers';
export * from './lasers';
export * from './layers';
export * from './projectiles';
export * from './stances';
export * from './targeting';
export * from './turrets';
export * from './vision';
export * from './weaponRows';

export const combatSystem = defineSystem({
  id: 'combat.stances',
  slot: 10,
  wave: 'W07',
  run(state, ctx) {
    battleOrchestrator.step(state, ctx);
  },
});

export default defineSimModule({
  id: 'combat',
  wave: 'W07',
  systems: [combatSystem],
  handlers: [setStanceHandler, setRallyHandler, attackMoveHandler, attackTargetHandler],
});
