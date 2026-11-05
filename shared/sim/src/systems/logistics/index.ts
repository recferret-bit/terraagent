import { defineSystem } from '../../kernel/system';
import type { StepContext } from '../../kernel/context';
import { withLedgerSink } from '../../kernel/ledgerSink';
import type { PlanetState } from '../../kernel/state';
import { defineSimModule } from '../define';
import { ensureColonyLedger } from '../economy/ledger';
import { collectInputs, planWindow, serviceParams, coefficientsOf } from './plan';
import { unitReserve } from './reserve-handler';
import { releaseGone, settleWindow, windowStillValid } from './settle';
import { colonyLogistics, readLogistics, writeLogistics, type ColonyLogistics } from './state';

export * from './state';
export * from './service';
export { unitReserve } from './reserve-handler';
export { readinessOf } from './inputs';

/**
 * Logistics supply windows (ECON-LOG-01/02, W13-53). Every window (a data row, in ticks of the one sim clock) each colony
 * with operating entities is evaluated (`evaluateLogistics`), its inputs are allocated by player priority and entity id,
 * reserved through the treasury (`logistics.supply`), consumed only for the delivered share (the rest is released), and local
 * reserves and grace persist per entity. The delivered-service ratio is exposed through `deliveredServiceBp`.
 */
function stepColony(state: PlanetState, ctx: StepContext, index: number, cs: ColonyLogistics): boolean {
  const col = state.colonies[index]!;
  ensureColonyLedger(col);
  const params = serviceParams(ctx.data, coefficientsOf(ctx.data));
  const w = cs.window;
  const current = Math.floor(ctx.tick / params.windowTicks);
  if (w && ctx.tick < w.endTick && windowStillValid(state, cs)) return false; // pinned: nothing changes until it ends or breaks
  const inputs = collectInputs(state, index, ctx.data);
  const hadWindow = w !== null;
  const seg = w && ctx.tick < w.endTick ? w.seg + 1 : 0; // route/capacity loss mid-window: settle the delivered part, replan the rest
  if (w) settleWindow(state, col, cs, ctx.tick);
  releaseGone(state, col, cs, inputs.liveIds, ctx.tick);
  const index2 = seg > 0 ? w!.index : current;
  const endTick = (index2 + 1) * params.windowTicks;
  if (inputs.buildings.length + inputs.units.length > 0 && endTick > ctx.tick) {
    cs.window = planWindow(state, col, cs, inputs, { data: ctx.data, tick: ctx.tick, index: index2, seg, endTick, params });
  }
  return hadWindow || cs.window !== null;
}

export const logisticsSystem = defineSystem({
  id: 'logistics.service',
  slot: 9,
  wave: 'W13',
  run(state, ctx) {
    const blob = readLogistics(state);
    let changed = false;
    withLedgerSink(state, ctx, () => {
      for (const col of state.colonies) {
        if (!col || col.status === 'eliminated') continue;
        const cs = colonyLogistics(blob, col.index);
        if (stepColony(state, ctx, col.index, cs)) changed = true;
      }
    });
    if (changed) writeLogistics(state, blob, ctx.tick);
  },
});

export default defineSimModule({ id: 'logistics', wave: 'W13', systems: [logisticsSystem], handlers: [unitReserve] });
