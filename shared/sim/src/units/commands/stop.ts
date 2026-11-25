import { ENTITY_STATE } from '../../ecs/columns';
import { hexIndex } from '../../grid/hex';
import { setUnitActivity } from '../approach';
import { cancelMove, getMotion, requestMove } from '../movement/orchestrator';
import { findNearestFreeStandTile, isHexStationaryOccupied } from '../movement/unitOccupancy';
import { defineUnitCommand, type StopCommand } from '../types';

/**
 * `stop` (immediate): drops the current and queued commands and the route, so the unit halts where it is. Auto work
 * (terraform, construction) does not pick the unit up again for `stopHoldS`. If halting mid-transit would leave two
 * units sharing the same hex, steps onto the nearest free adjacent stand tile.
 */
export const stopCommand = defineUnitCommand<StopCommand>({
  kind: 'stop',
  immediate: true,
  execute(u) {
    const prevMotion = getMotion(u.state, u.id);
    const wasStationary = !prevMotion || prevMotion.status !== 'following';
    u.record.current = null;
    u.record.queue = [];
    u.record.holdUntil = u.ctx.tick + u.stats.stopHoldTicks;
    cancelMove(u.state, u.id, u.ctx.tick);
    const cols = u.state.entities.cols;
    const curQ = cols.q[u.row];
    const curR = cols.r[u.row];
    const curIdx = hexIndex(u.state.grid.radius).indexOf(curQ, curR);
    if (isHexStationaryOccupied(u.state, curIdx, u.id, u.ctx.data, wasStationary)) {
      const free = findNearestFreeStandTile(u.state, curQ, curR, u.stats.profile, u.id, u.ctx.data, 2);
      if (free && (free.q !== curQ || free.r !== curR)) {
        u.record.current = { kind: 'move', source: 'auto', q: free.q, r: free.r, minDist: 0, maxDist: 0, deoverlap: true };
        requestMove(u.state, u.row, { q: free.q, r: free.r, minDist: 0, maxDist: 0 }, u.ctx);
        setUnitActivity(u, ENTITY_STATE.moving, free.q, free.r);
        return 'running';
      }
    }
    setUnitActivity(u, ENTITY_STATE.idle, curQ, curR);
    return 'done';
  },
});
