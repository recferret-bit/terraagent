import { defineSystem } from '../../kernel/system';
import { defineSimModule } from '../define';
import { stepFauna } from './step';

export * from './types';
export * from './insectActions';
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

export default defineSimModule({
  id: 'fauna',
  wave: 'W07',
  systems: [faunaSystem],
  handlers: [],
});
