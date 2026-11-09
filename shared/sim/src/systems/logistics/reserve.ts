import { ENTITY_STATE } from '../../ecs/columns';
import { colonyActor } from '../../economy/accounts';
import { treasury, treasuryCtx } from '../../economy/treasury';
import type { Amounts } from '../../economy/treasury';
import { setUnitActivity } from '../../units/approach';
import { cancelMove } from '../../units/movement/orchestrator';
import { defineUnitCommand, type ReserveCommand } from '../../units/types';
import { checkCostAffordability } from '../economy/ledger';
import { w01Row } from '../rows';

interface Deploy { version: number; delayTicks: number; cost: Amounts }
const deployOf = (data: Parameters<typeof w01Row>[0]): Deploy => {
  const r = w01Row(data, 'logistics', 'deploy.v1');
  return { version: Number(r.version), delayTicks: Math.max(0, Math.round(Number(r.activationDelayS))), cost: r.activationCost as Amounts };
};

/**
 * `reserve` (immediate unit command, SIM-M-01). `on`: drops current and queued work and the route (no attack/production)
 * and marks the unit reserved; ownership and control-slot use are kept. `off`: charges the versioned activation recipe
 * through the treasury (every time) and starts the deployment delay; a unit still deploying or not in reserve is a no-op,
 * so toggling cannot skip the cost, finish a pending attack or refill grace (reserves and grace are keyed by entity id).
 */
export const reserveCommand = defineUnitCommand<ReserveCommand>({
  kind: 'reserve',
  immediate: true,
  validate(u, c) {
    if (c.on || !u.record.reserve || u.record.reserve.mode !== 'reserve') return;
    const owner = u.state.colonies[u.owner];
    if (!owner || !checkCostAffordability(owner, deployOf(u.ctx.data).cost).ok) return 'insufficient_resources';
  },
  execute(u, c) {
    const rec = u.record;
    if (c.on) {
      rec.current = null;
      rec.queue = [];
      cancelMove(u.state, u.id, u.ctx.tick);
      const cols = u.state.entities.cols;
      setUnitActivity(u, ENTITY_STATE.idle, cols.q[u.row], cols.r[u.row]);
      rec.reserve = { mode: 'reserve', readyAt: 0, version: deployOf(u.ctx.data).version };
      return 'done';
    }
    if (rec.reserve?.mode !== 'reserve') return 'done'; // not in reserve, or already deploying: nothing to charge twice
    const d = deployOf(u.ctx.data);
    const res = treasury(u.state, treasuryCtx(u.ctx.tick, u.ctx)).withdraw({
      colony: u.owner, amounts: d.cost, reason: 'logistics.activate', actor: colonyActor(u.state, u.owner), ref: `activate:${u.id}:${u.ctx.tick}`,
    });
    if (!res.ok) return 'failed';
    rec.reserve = { mode: 'activating', readyAt: u.ctx.tick + d.delayTicks, version: d.version };
    return 'done';
  },
});
