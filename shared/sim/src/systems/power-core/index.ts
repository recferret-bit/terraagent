import { compileData, dataRow, type CompiledRow } from '../../data';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { setField } from '../../ecs/store';
import type { CompiledDataLike } from '../../kernel/config';
import type { StepContext } from '../../kernel/context';
import { setBlob, type PlanetState, type PlanetType } from '../../kernel/state';
import { defineSystem } from '../../kernel/system';
import { defineSimModule } from '../define';
import { getEnvironment } from '../environment';
import { evaluatePowerEventsForColony, type PowerEventTracker } from './events';
import { collectWorkLoad } from './workLoad';
import { buildPowerGraph } from './graph';
import { evaluateWindOutput } from './windAndCap';
import type { ColonyPowerSummary, EntityPowerStatus, PowerComponentSummary } from './types';
import {
  evaluateSingleComponent,
  processUnattachedBuildings,
  calculateUnitDemand,
  applyOfflineStatuses,
  type ComponentEvalResult,
} from './evaluate';
import { summarizeComponentStores } from './hqCell';

export * from './types';
export * from './shedding';
export * from './solar';
export * from './events';
export * from './thermal';
export * from './graph';
export * from './windAndCap';
export * from './evaluate';
export * from './overload';
export * from './drains';
export * from './hqCell';
export { collectWorkLoad, terraformOpShedGroup, type WorkLoad } from './workLoad';

let cachedW02Data: CompiledDataLike | null = null;
function defaultW02Data(): CompiledDataLike {
  if (!cachedW02Data) cachedW02Data = compileData(new Set(['W00', 'W01', 'W02', 'W10']));
  return cachedW02Data;
}

let cachedW03Data: CompiledDataLike | null = null;
function defaultW03Data(): CompiledDataLike {
  if (!cachedW03Data) cachedW03Data = compileData(new Set(['W00', 'W01', 'W02', 'W03']));
  return cachedW03Data;
}

export function resolvePowerRow(data: CompiledDataLike | undefined, table: string, id: string): CompiledRow {
  const t = data?.tables?.[table] as Record<string, CompiledRow> | undefined;
  if (t?.[id]) return t[id];
  if (table === 'grid') return dataRow(defaultW03Data(), table, id);
  return dataRow(defaultW02Data(), table, id);
}

/** Computes Solar T1 gross, internal drain, and net output (E/s) for a given `daylight` and `planetType`. */
export function computeSolarOutputPerS(
  daylight: number,
  planetType: PlanetType,
  data?: CompiledDataLike,
): { gross: number; internalDrain: number; net: number } {
  const solarRow = resolvePowerRow(data, 'economyT1Basic', 'solar');
  const baseGross = Number(solarRow.grossOutputPerS ?? 21);
  const internalDrain = Number(solarRow.internalDrainPerS ?? 1);
  const desertMult = planetType === 'desert' ? Number(solarRow.desertBonusMult ?? 1.35) : 1.0;
  const clampedDaylight = Math.max(0, Math.min(1, daylight));
  const gross = Number((baseGross * clampedDaylight * desertMult).toFixed(4));
  const net = Number((gross - internalDrain).toFixed(4));
  return { gross, internalDrain, net };
}

function syncTradeHubPowerAvailability(state: PlanetState, colonyIndex: number, tick: number, data?: CompiledDataLike): void {
  const e = state.entities, c = e.cols;
  const enabled = !data?.tables || Boolean((data.tables.tradeHub as Record<string, unknown> | undefined)?.t1);
  for (let row = 0; row < e.count; row++) {
    if (c.owner[row] !== colonyIndex || c.kind[row] !== ENTITY_KIND.tradeHub || c.hp[row] <= 0 || c.state[row] === ENTITY_STATE.constructing) continue;
    if (!enabled && c.state[row] !== ENTITY_STATE.inert) setField(e, row, 'state', ENTITY_STATE.inert, tick);
    else if (enabled && c.state[row] === ENTITY_STATE.inert) setField(e, row, 'state', ENTITY_STATE.active, tick);
  }
}

/** Evaluates colony power across all power graph components with per-component brownout shedding (W03-05, W03-07). */
export function evaluateColonyPower(
  state: PlanetState,
  colonyIndex: number,
  data?: CompiledDataLike,
  tick: number = state.meta.tick,
  dtTicks = 0,
): ColonyPowerSummary {
  const env = getEnvironment(state, data);
  const windOut = evaluateWindOutput(state, colonyIndex, tick, data);
  syncTradeHubPowerAvailability(state, colonyIndex, tick, data);
  const graph = buildPowerGraph(state, colonyIndex, data);
  const hubRow = resolvePowerRow(data, 'hub', 't1');
  const founderCorePerS = graph.hasHub ? Number(hubRow.founderCoreGenPerS ?? 8) * graph.hubAnchors.length : 0;

  const col = state.colonies[colonyIndex];
  if (col) col.pollution = Number(col.pollution ?? 0);

  const unitDemand = calculateUnitDemand(state, colonyIndex, data);
  const work = graph.hasHub ? collectWorkLoad(state, colonyIndex, data) : { demand: 0, candidates: [] };

  let totalSupply = 0, totalRawDemand = 0, totalDemand = 0, totalBuildingDemand = 0;
  let solarGross = 0, solarDrain = 0, solarNet = 0;
  let thermalGross = 0, thermalDrain = 0, thermalNet = 0;
  let windGross = 0, windDrain = 0, windNet = 0;
  const results: ComponentEvalResult[] = [];

  const unpoweredEntityIds: number[] = [], nightSolarEntityIds: number[] = [], noFuelEntityIds: number[] = [];
  const allShedEntityIds: number[] = [], allShedWorkJobIds: string[] = [];
  const allOverloadedEntityIds: number[] = [];
  const pylonLoads: Record<number, { flow: number; max: number; overloaded?: boolean; shedEntityIds?: number[] }> = {};
  const allShedGroupsSet = new Set<number>();
  let hqFastRechargeShed = false;
  let totalShedWorkDemand = 0;
  const componentsSummary: PowerComponentSummary[] = [];
  const entityPower: Record<number, EntityPowerStatus> = {};
  const offlineReasons: Record<number, string> = {};

  for (const comp of graph.components) {
    const res = evaluateSingleComponent(
      state, colonyIndex, comp, graph, env, windOut, unitDemand, work, graph.hubAnchors, dtTicks, tick, data,
    );
    componentsSummary.push(res.summary);
    results.push(res);
    totalSupply += res.effectiveSupply;
    totalRawDemand += res.rawDemand;
    totalDemand += res.demand;
    totalBuildingDemand += res.buildingDemand;
    solarGross += res.solarGross; solarDrain += res.solarDrain; solarNet += res.solarNet;
    thermalGross += res.thermalGross; thermalDrain += res.thermalDrain; thermalNet += res.thermalNet;
    windGross += res.windGross; windDrain += res.windDrain; windNet += res.windNet;
    unpoweredEntityIds.push(...res.unpoweredIds);
    nightSolarEntityIds.push(...res.nightSolarIds);
    noFuelEntityIds.push(...res.noFuelIds);
    allShedEntityIds.push(...res.shed.shedEntityIds);
    allOverloadedEntityIds.push(...res.overloadedEntityIds);
    Object.assign(pylonLoads, res.pylonLoads);
    for (const g of res.shed.shedGroupsActive) allShedGroupsSet.add(g);
    allShedWorkJobIds.push(...res.shed.shedWorkJobIds);
    totalShedWorkDemand += res.shed.shedWorkDemand;
    if (res.shed.hqFastRechargeShed) hqFastRechargeShed = true;
    for (const [idStr, r] of Object.entries(res.shed.offlineReasons)) offlineReasons[Number(idStr)] = r;
    for (const id of res.onlineEntityIds) entityPower[id] = { state: 'online', component: comp.componentId };
  }

  processUnattachedBuildings(state, graph, tick, unpoweredEntityIds, offlineReasons, entityPower, data);

  applyOfflineStatuses(
    graph,
    unpoweredEntityIds,
    nightSolarEntityIds,
    noFuelEntityIds,
    allShedEntityIds,
    allOverloadedEntityIds,
    offlineReasons,
    entityPower,
  );

  const workDemand = Math.max(0, Number((work.demand - totalShedWorkDemand).toFixed(4)));
  const effectiveSupply = Math.max(0, Number(totalSupply.toFixed(4)));
  const demand = Math.max(0, Number(totalDemand.toFixed(4)));
  const rawDemand = Math.max(0, Number(totalRawDemand.toFixed(4)));
  const buildingDemand = Math.max(0, Number(totalBuildingDemand.toFixed(4)));
  const net = Number((effectiveSupply - demand).toFixed(4));
  const shedGroupsActive = [...allShedGroupsSet].sort((a, b) => a - b);
  const brownout = allShedEntityIds.length > 0 || allShedWorkJobIds.length > 0 || rawDemand > effectiveSupply + 1e-6;

  return {
    colonyIndex, hasHub: graph.hasHub, founderCorePerS,
    solarGrossPerS: Number(solarGross.toFixed(4)), solarInternalDrainPerS: Number(solarDrain.toFixed(4)), solarNetPerS: Number(solarNet.toFixed(4)),
    thermalGrossPerS: Number(thermalGross.toFixed(4)), thermalInternalDrainPerS: Number(thermalDrain.toFixed(4)), thermalNetPerS: Number(thermalNet.toFixed(4)),
    windFactor: windOut.windFactor, windGrossPerS: Number(windGross.toFixed(4)), windInternalDrainPerS: Number(windDrain.toFixed(4)), windNetPerS: Number(windNet.toFixed(4)),
    ...summarizeComponentStores(results),
    supply: effectiveSupply, demand, rawDemand, buildingDemand, unitDemand: Number(unitDemand.toFixed(4)), workDemand,
    net, brownout,
    shedGroupsActive, shedEntityIds: allShedEntityIds, shedWorkJobIds: allShedWorkJobIds,
    unpoweredEntityIds, hqFastRechargeShed, offlineReasons,
    daylight: env.daylight, phase: env.phase, clockText: env.clockText, entityPower, components: componentsSummary,
    pylonLoads, overloadedEntityIds: allOverloadedEntityIds,
  };
}

export function notifyPylonOrBuildingRemoved(
  state: PlanetState,
  entityId: number,
  tick: number = state.meta.tick,
  data?: CompiledDataLike,
  ctx?: StepContext,
): void {
  const summaries = recomputeAllColonyPower(state, data, tick);
  if (ctx) {
    const prevBlob = (state.blobs.power?.value as {
      trackers?: Record<number, PowerEventTracker>;
    } | undefined) ?? {};
    const prevTrackers = prevBlob.trackers ?? {};
    const trackers: Record<number, PowerEventTracker> = {};
    for (const [colIdxStr, summary] of Object.entries(summaries)) {
      const colIdx = Number(colIdxStr);
      trackers[colIdx] = evaluatePowerEventsForColony(state, colIdx, summary, prevTrackers[colIdx], ctx, data);
    }
    setBlob(state, 'power', { byColony: summaries, trackers }, tick);
  }
}

export function getColonyPower(state: PlanetState, colonyIndex = 0, data?: CompiledDataLike): ColonyPowerSummary {
  const fromColony = state.colonies[colonyIndex]?.power as ColonyPowerSummary | undefined;
  if (fromColony && typeof fromColony.supply === 'number') return fromColony;
  const fromBlob = (state.blobs.power?.value as { byColony?: Record<number, ColonyPowerSummary> } | undefined)?.byColony?.[colonyIndex];
  if (fromBlob) return fromBlob;
  return evaluateColonyPower(state, colonyIndex, data, state.meta.tick);
}

export function recomputeAllColonyPower(
  state: PlanetState,
  data?: CompiledDataLike,
  tick: number = state.meta.tick,
  dtTicks = 0,
  ctx?: StepContext,
): Record<number, ColonyPowerSummary> {
  const prevTrackers = (state.blobs.power?.value as { trackers?: Record<number, PowerEventTracker> } | undefined)?.trackers ?? {};
  const byColony: Record<number, ColonyPowerSummary> = {};
  const trackers: Record<number, PowerEventTracker> = {};
  const colonyIndices = new Set<number>();
  for (const c of state.colonies) colonyIndices.add(c.index);
  for (let row = 0; row < state.entities.count; row++) colonyIndices.add(state.entities.cols.owner[row]);
  if (colonyIndices.size === 0) colonyIndices.add(0);

  for (const idx of colonyIndices) {
    const summary = evaluateColonyPower(state, idx, data, tick, dtTicks);
    byColony[idx] = summary;
    if (ctx) {
      trackers[idx] = evaluatePowerEventsForColony(state, idx, summary, prevTrackers[idx], ctx, data);
    }
    const col = state.colonies[idx];
    if (col) { col.power = summary; col.changedAt = tick; }
  }
  setBlob(state, 'power', { byColony, trackers: ctx ? trackers : prevTrackers }, tick);
  return byColony;
}

const powerCoreSystem = defineSystem({
  id: 'power.core',
  slot: 7,
  wave: 'W02',
  run(state, ctx) {
    const prevBlob = (state.blobs.power?.value as {
      byColony?: Record<number, ColonyPowerSummary>;
      trackers?: Record<number, PowerEventTracker>;
    } | undefined) ?? {};
    const prevTrackers = prevBlob.trackers ?? {};
    const byColony: Record<number, ColonyPowerSummary> = {};
    const trackers: Record<number, PowerEventTracker> = {};
    const colonyIndices = new Set<number>();
    for (const c of state.colonies) colonyIndices.add(c.index);
    for (let row = 0; row < state.entities.count; row++) colonyIndices.add(state.entities.cols.owner[row]);
    if (colonyIndices.size === 0) colonyIndices.add(0);

    for (const idx of colonyIndices) {
      const summary = evaluateColonyPower(state, idx, ctx.data, ctx.tick, ctx.dt);
      byColony[idx] = summary;
      trackers[idx] = evaluatePowerEventsForColony(state, idx, summary, prevTrackers[idx], ctx, ctx.data);
      const col = state.colonies[idx];
      if (col) { col.power = summary; col.changedAt = ctx.tick; }
    }
    setBlob(state, 'power', { byColony, trackers }, ctx.tick);
  },
});

export default defineSimModule({
  id: 'power-core',
  wave: 'W02',
  systems: [powerCoreSystem],
});
