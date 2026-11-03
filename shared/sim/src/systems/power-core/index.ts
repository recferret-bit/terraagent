import { compileData, dataRow, type CompiledRow } from '../../data';
import type { CompiledDataLike } from '../../kernel/config';
import type { StepContext } from '../../kernel/context';
import { setBlob, type PlanetState, type PlanetType } from '../../kernel/state';
import { defineSystem } from '../../kernel/system';
import { defineSimModule } from '../define';
import { getEnvironment } from '../environment';
import { applyBrownoutShedding, type ShedCandidate } from './shedding';
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
} from './evaluate';

export * from './types';
export * from './shedding';
export * from './solar';
export * from './events';
export * from './thermal';
export * from './graph';
export * from './windAndCap';
export * from './evaluate';
export { collectWorkLoad, terraformOpShedGroup, type WorkLoad } from './workLoad';

let cachedW02Data: CompiledDataLike | null = null;
function defaultW02Data(): CompiledDataLike {
  if (!cachedW02Data) cachedW02Data = compileData(new Set(['W00', 'W01', 'W02']));
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

/** Evaluates colony power across all power graph components with brownout shedding (W03-05). */
export function evaluateColonyPower(
  state: PlanetState,
  colonyIndex: number,
  data?: CompiledDataLike,
  tick: number = state.meta.tick,
  dtTicks = 0,
): ColonyPowerSummary {
  const env = getEnvironment(state, data);
  const windOut = evaluateWindOutput(state, colonyIndex, tick, data);
  const graph = buildPowerGraph(state, colonyIndex, data);
  const hubRow = resolvePowerRow(data, 'hub', 't1');
  const founderCorePerS = graph.hasHub ? Number(hubRow.founderCoreGenPerS ?? 8) * graph.hubAnchors.length : 0;

  const col = state.colonies[colonyIndex];
  if (col) col.pollution = Number(col.pollution ?? 0);

  let totalSupply = 0, rawBuildingDemand = 0;
  let solarGross = 0, solarDrain = 0, solarNet = 0;
  let thermalGross = 0, thermalDrain = 0, thermalNet = 0;
  let windGross = 0, windDrain = 0, windNet = 0;
  let capStoredE = 0, capCapacityE = 0, capDischargePerS = 0, capChargePerS = 0;

  const unpoweredEntityIds: number[] = [], nightSolarEntityIds: number[] = [], noFuelEntityIds: number[] = [];
  const allShedCandidates: ShedCandidate[] = [], componentsSummary: PowerComponentSummary[] = [];
  const entityPower: Record<number, EntityPowerStatus> = {};

  for (const comp of graph.components) {
    const res = evaluateSingleComponent(state, colonyIndex, comp, env, windOut, dtTicks, tick, data);
    componentsSummary.push(res.summary);
    totalSupply += res.effectiveSupply;
    rawBuildingDemand += res.demand;
    solarGross += res.solarGross; solarDrain += res.solarDrain; solarNet += res.solarNet;
    thermalGross += res.thermalGross; thermalDrain += res.thermalDrain; thermalNet += res.thermalNet;
    windGross += res.windGross; windDrain += res.windDrain; windNet += res.windNet;
    capStoredE += res.capStoredE; capCapacityE += res.capCapacityE;
    capDischargePerS += res.capDischargePerS; capChargePerS += res.capChargePerS;
    unpoweredEntityIds.push(...res.unpoweredIds);
    nightSolarEntityIds.push(...res.nightSolarIds);
    noFuelEntityIds.push(...res.noFuelIds);
    allShedCandidates.push(...res.shedCandidates);
    for (const id of res.onlineEntityIds) entityPower[id] = { state: 'online', component: comp.componentId };
  }

  const offlineReasons: Record<number, string> = {};
  processUnattachedBuildings(state, graph, tick, unpoweredEntityIds, offlineReasons, entityPower, data);

  const unitDemand = calculateUnitDemand(state, colonyIndex, data);
  const work = graph.hasHub ? collectWorkLoad(state, colonyIndex, data) : { demand: 0, candidates: [] };
  allShedCandidates.push(...work.candidates);

  const rawDemand = Number((rawBuildingDemand + unitDemand + work.demand).toFixed(4));
  const effectiveSupply = Math.max(0, Number(totalSupply.toFixed(4)));
  const shed = applyBrownoutShedding(state, colonyIndex, effectiveSupply, rawDemand, allShedCandidates, graph.hubAnchors, tick, data);

  applyOfflineStatuses(graph, shed, unpoweredEntityIds, nightSolarEntityIds, noFuelEntityIds, offlineReasons, entityPower);

  const demand = shed.remainingDemand;
  const workDemand = Math.max(0, Number((work.demand - shed.shedWorkDemand).toFixed(4)));
  const buildingDemand = Math.max(0, Number((demand - unitDemand - workDemand).toFixed(4)));
  const net = Number((effectiveSupply - demand).toFixed(4));

  return {
    colonyIndex, hasHub: graph.hasHub, founderCorePerS,
    solarGrossPerS: Number(solarGross.toFixed(4)), solarInternalDrainPerS: Number(solarDrain.toFixed(4)), solarNetPerS: Number(solarNet.toFixed(4)),
    thermalGrossPerS: Number(thermalGross.toFixed(4)), thermalInternalDrainPerS: Number(thermalDrain.toFixed(4)), thermalNetPerS: Number(thermalNet.toFixed(4)),
    windFactor: windOut.windFactor, windGrossPerS: Number(windGross.toFixed(4)), windInternalDrainPerS: Number(windDrain.toFixed(4)), windNetPerS: Number(windNet.toFixed(4)),
    capacitorStoredE: capStoredE, capacitorCapacityE: capCapacityE, capacitorDischargePerS: capDischargePerS, capacitorChargePerS: capChargePerS,
    supply: effectiveSupply, demand, rawDemand, buildingDemand, unitDemand: Number(unitDemand.toFixed(4)), workDemand,
    net, brownout: shed.shedEntityIds.length > 0 || shed.shedWorkJobIds.length > 0 || rawDemand > effectiveSupply + 1e-6,
    shedGroupsActive: shed.shedGroupsActive, shedEntityIds: shed.shedEntityIds, shedWorkJobIds: shed.shedWorkJobIds,
    unpoweredEntityIds, hqFastRechargeShed: shed.hqFastRechargeShed, offlineReasons: shed.offlineReasons,
    daylight: env.daylight, phase: env.phase, clockText: env.clockText, entityPower, components: componentsSummary,
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
): Record<number, ColonyPowerSummary> {
  const prevTrackers = (state.blobs.power?.value as { trackers?: Record<number, PowerEventTracker> } | undefined)?.trackers ?? {};
  const byColony: Record<number, ColonyPowerSummary> = {};
  const colonyIndices = new Set<number>();
  for (const c of state.colonies) colonyIndices.add(c.index);
  for (let row = 0; row < state.entities.count; row++) colonyIndices.add(state.entities.cols.owner[row]);
  if (colonyIndices.size === 0) colonyIndices.add(0);

  for (const idx of colonyIndices) {
    const summary = evaluateColonyPower(state, idx, data, tick, dtTicks);
    byColony[idx] = summary;
    const col = state.colonies[idx];
    if (col) { col.power = summary; col.changedAt = tick; }
  }
  setBlob(state, 'power', { byColony, trackers: prevTrackers }, tick);
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
