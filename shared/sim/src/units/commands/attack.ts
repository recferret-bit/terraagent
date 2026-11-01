import { ENTITY_STATE } from '../../ecs/columns';
import { rowOf, setField } from '../../ecs/store';
import { hexDistance } from '../../grid/hex';
import { TICK_MS } from '../../kernel/constants';
import { approach, setUnitActivity } from '../approach';
import { isUnitKind } from '../mobility';
import { faceTowards } from '../movement/locomotion';
import { cancelMove } from '../movement/orchestrator';
import { defineUnitCommand, type AttackCommand } from '../types';

/**
 * `attack`: close to weapon range of the target (re-planning when it drifts more than a tile), then deal the unit's
 * DPS each step until the target's HP reaches 0. A unit target then dies through its own `die` command (runner); a
 * building target turns `inert`.
 */
export const attackCommand = defineUnitCommand<AttackCommand>({
  kind: 'attack',
  key: (c) => `attack:${c.targetId}`,
  validate(u, c) {
    if (u.stats.dps <= 0 || u.stats.weaponRange <= 0) return 'cannot_attack';
    const t = rowOf(u.state.entities, c.targetId);
    if (t < 0) return 'unknown_entity';
    const cols = u.state.entities.cols;
    if (t === u.row || cols.owner[t] === u.owner) return 'invalid_target';
    if (cols.hp[t] <= 0) return 'invalid_target';
  },
  execute(u, c) {
    const e = u.state.entities;
    const cols = e.cols;
    const t = rowOf(e, c.targetId);
    if (t < 0 || cols.hp[t] <= 0) return 'done';
    const range = u.stats.weaponRange;
    const inRange = hexDistance(cols.x[u.row], cols.y[u.row], cols.x[t], cols.y[t]) <= range;
    if (!inRange) {
      const status = approach(u, { q: cols.q[t], r: cols.r[t], minDist: 0, maxDist: range }, 1);
      if (status === 'arrived') cancelMove(u.state, u.id, u.ctx.tick); // the target drifted out of range: re-plan next step
      return status === 'failed' ? 'failed' : 'running';
    }
    cancelMove(u.state, u.id, u.ctx.tick);
    setUnitActivity(u, ENTITY_STATE.working, cols.q[t], cols.r[t]);
    faceTowards(u.state, u.row, cols.q[t], cols.r[t], u.ctx.tick);
    const dmg = (u.stats.dps * TICK_MS * u.ctx.dt) / 1000;
    const hp = Math.fround(Math.max(0, cols.hp[t] - dmg));
    setField(e, t, 'hp', hp, u.ctx.tick);
    if (hp > 0) return 'running';
    if (!isUnitKind(cols.kind[t])) setField(e, t, 'state', ENTITY_STATE.inert, u.ctx.tick);
    return 'done';
  },
});
