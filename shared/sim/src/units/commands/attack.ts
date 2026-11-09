import { combatApproachBand, footprintAttackRange } from '../../systems/combat/approachBand';
import { ENTITY_STATE } from '../../ecs/columns';
import { speciesOfEntityKind } from '../../systems/fauna/types';
import { rowOf, setField } from '../../ecs/store';
import { hexDistance } from '../../grid/hex';
import { TICK_MS } from '../../kernel/constants';
import { applyDamage } from '../../systems/combat/damage';
import { approach, setUnitActivity } from '../approach';
import { isUnitKind } from '../mobility';
import { faceTowards } from '../movement/locomotion';
import { cancelMove } from '../movement/orchestrator';
import { defineUnitCommand, type AttackCommand } from '../types';

/**
 * `attack`: close to weapon range of the target (re-planning when it drifts more than a tile), then deal the unit's
 * DPS each step until the target's HP reaches 0. A unit target then dies through its own `die` command (runner); a
 * building target turns `inert`.
 *
 * Not exposed in W01 (no command handler issues it; the combat slot runs it for tests and later waves). Before a player
 * command issues it, add the protection rules (raid protection, truce, own-territory buildings: `raid_protected`,
 * `truce_active`). Rejections use registered codes only (GP-20): a unit without a weapon or a bad target is `invalid_args`.
 */
export const attackCommand = defineUnitCommand<AttackCommand>({
  kind: 'attack',
  key: (c) => `attack:${c.targetId}`,
  validate(u, c) {
    if (u.stats.dps <= 0 || u.stats.weaponRange <= 0) return 'invalid_args';
    const t = rowOf(u.state.entities, c.targetId);
    if (t < 0) return 'unknown_entity';
    const cols = u.state.entities.cols;
    if (t === u.row || cols.owner[t] === u.owner || cols.hp[t] <= 0) return 'invalid_args';
  },
  phase: 'combat',
  /** Units slot: close to weapon range (the shooting happens in the combat slot). */
  execute(u, c) {
    const e = u.state.entities;
    const cols = e.cols;
    const t = rowOf(e, c.targetId);
    if (t < 0 || cols.hp[t] <= 0) return 'done';
    const fauna = speciesOfEntityKind(cols.kind[u.row]) !== null;
    const range = fauna ? footprintAttackRange(u.stats.weaponRange, cols.footprintW[t]) : u.stats.weaponRange;
    if (hexDistance(cols.x[u.row], cols.y[u.row], cols.x[t], cols.y[t]) > range) {
      const band = combatApproachBand(range, 0, hexDistance(cols.q[u.row], cols.r[u.row], cols.q[t], cols.r[t]),
        hexDistance(cols.x[t], cols.y[t], cols.q[t], cols.r[t]));
      const status = approach(u, { q: cols.q[t], r: cols.r[t], ...band }, 1);
      if (status === 'arrived') cancelMove(u.state, u.id, u.ctx.tick); // the target drifted out of range: re-plan next step
      return status === 'failed' ? 'failed' : 'running';
    }
    cancelMove(u.state, u.id, u.ctx.tick);
    setUnitActivity(u, ENTITY_STATE.working, cols.q[t], cols.r[t]);
    faceTowards(u.state, u.row, cols.q[t], cols.r[t], u.ctx.tick);
    return 'running';
  },
  /** Combat slot: DPS × dt on a target still in range. */
  work(u, c) {
    // W07 insects release discrete attacks through the shared fauna action clock.
    // Their generic command handles approach only, never an extra continuous DPS stream.
    const kind = u.state.entities.cols.kind[u.row];
    if (u.ctx.flags.has('W07') && speciesOfEntityKind(kind) !== null) return 'running';
    const e = u.state.entities;
    const cols = e.cols;
    const t = rowOf(e, c.targetId);
    if (t < 0 || cols.hp[t] <= 0) return 'done';
    if (hexDistance(cols.x[u.row], cols.y[u.row], cols.x[t], cols.y[t]) > u.stats.weaponRange) return 'running';
    const dmg = (u.stats.dps * TICK_MS * u.ctx.dt) / 1000;
    if (u.ctx.flags.has('W07')) {
      const res = applyDamage(u.state, c.targetId, dmg, {
        attackerId: u.id,
        attackerOwner: u.owner,
        tick: u.ctx.tick,
        ctx: u.ctx,
        data: u.ctx.data,
      });
      if (res.destroyed || res.clampedHq) return 'done';
      return 'running';
    }
    const hp = Math.fround(Math.max(0, cols.hp[t] - dmg));
    setField(e, t, 'hp', hp, u.ctx.tick);
    if (hp > 0) return 'running';
    if (!isUnitKind(cols.kind[t])) setField(e, t, 'state', ENTITY_STATE.inert, u.ctx.tick);
    return 'done';
  },
});
