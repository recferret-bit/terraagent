import { defineSystem } from '../../kernel/system';
import { defineSimModule } from '../define';
import { moveUnit, stopUnit } from './handlers';
import { issueUnitCommand, stepUnits, stepUnitWork, UNIT_REGISTRY } from './registry';

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

/** Construction slot (6), before `constructionSite`: build and terraform progress of units standing in reach. */
export const constructionProgress = defineSystem({
  id: 'constructionProgress',
  slot: 6,
  wave: 'W01',
  run(state, ctx) {
    stepUnitWork('construction', state, ctx);
  },
});

/** Combat slot (10): damage of units in weapon range of their attack target. */
export const combat = defineSystem({
  id: 'combat',
  slot: 10,
  wave: 'W01',
  run(state, ctx) {
    stepUnitWork('combat', state, ctx);
  },
});

export default defineSimModule({
  id: 'units',
  wave: 'W01',
  systems: [units, constructionProgress, combat],
  handlers: [moveUnit, stopUnit],
});
