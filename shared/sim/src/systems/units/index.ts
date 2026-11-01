import { defineSystem } from '../../kernel/system';
import { defineSimModule } from '../define';
import { moveUnit, stopUnit } from './handlers';
import { issueUnitCommand, stepUnits, UNIT_REGISTRY } from './registry';

export { issueUnitCommand, moveUnit, stopUnit, UNIT_REGISTRY };

/**
 * Units (slot 5): every unit's commands, the movement orchestrator and locomotion, in one deterministic pass
 * (`units/runner.ts`). Systems never move or task a unit directly; they queue work that a provider turns into a
 * unit command, or call `issueUnitCommand`.
 */
export const units = defineSystem({
  id: 'units',
  slot: 5,
  wave: 'W01',
  run(state, ctx) {
    stepUnits(state, ctx);
  },
});

export default defineSimModule({
  id: 'units',
  wave: 'W01',
  systems: [units],
  handlers: [moveUnit, stopUnit],
});
