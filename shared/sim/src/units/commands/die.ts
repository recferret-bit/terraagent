import { ENTITY_STATE } from '../../ecs/columns';
import { setField } from '../../ecs/store';
import { setUnitActivity } from '../approach';
import { cancelMove } from '../movement/orchestrator';
import { defineUnitCommand, type DieCommand } from '../types';

/**
 * `die` (immediate): the unit is destroyed. HP goes to 0, every command and the route are dropped and the unit turns
 * `inert`; the runner never drives an inert unit again. Issued by the runner for any unit whose HP reached 0.
 */
export const dieCommand = defineUnitCommand<DieCommand>({
  kind: 'die',
  immediate: true,
  execute(u) {
    u.record.current = null;
    u.record.queue = [];
    cancelMove(u.state, u.id, u.ctx.tick);
    const cols = u.state.entities.cols;
    if (cols.hp[u.row] !== 0) setField(u.state.entities, u.row, 'hp', 0, u.ctx.tick);
    setUnitActivity(u, ENTITY_STATE.inert, cols.q[u.row], cols.r[u.row]);
    return 'done';
  },
});
