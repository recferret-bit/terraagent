import { defineSystem } from '../../kernel/system';
import { defineSimModule } from '../define';
import { stepFauna, stepFaunaCombat } from './step';

export * from './types';
export * from './state';
export * from './spawn';
export * from './provocation';
export * from './waves';
export * from './step';

/**
 * Fauna system (slot 3): neutral species hives (`blackAnt`, `blueBeetle`, `greenSpitter`), passive
 * home-area wandering via unit commands, resident replenishment, and colony-scoped provocation.
 */
export const faunaSystem = defineSystem({
  id: 'fauna',
  slot: 3,
  wave: 'W07',
  run(state, ctx) {
    stepFauna(state, ctx);
  },
});

/**
 * Fauna combat system (slot 10): executes melee bites and ranged acid shots for provoked bugs in range,
 * and resolves due projectile impacts.
 */
export const faunaCombatSystem = defineSystem({
  id: 'fauna.combat',
  slot: 10,
  wave: 'W07',
  run(state, ctx) {
    stepFaunaCombat(state, ctx);
  },
});

export default defineSimModule({
  id: 'fauna',
  wave: 'W07',
  systems: [faunaSystem, faunaCombatSystem],
  handlers: [],
});
