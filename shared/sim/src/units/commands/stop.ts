import { ENTITY_STATE } from '../../ecs/columns';
import { setUnitActivity } from '../approach';
import { cancelMove } from '../movement/orchestrator';
import { defineUnitCommand, type StopCommand } from '../types';

/**
 * `stop` (immediate): drops the current and queued commands and the route, so the unit halts where it is. Auto work
 * (terraform, construction) does not pick the unit up again for `stopHoldS`.
 */
export const stopCommand = defineUnitCommand<StopCommand>({
  kind: 'stop',
  immediate: true,
  execute(u) {
    u.record.current = null;
    u.record.queue = [];
    u.record.holdUntil = u.ctx.tick + u.stats.stopHoldTicks;
    cancelMove(u.state, u.id, u.ctx.tick);
    const cols = u.state.entities.cols;
    setUnitActivity(u, ENTITY_STATE.idle, cols.q[u.row], cols.r[u.row]);
    return 'done';
  },
});
