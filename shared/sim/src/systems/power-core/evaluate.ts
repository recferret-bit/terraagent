import type { CompiledDataLike } from '../../kernel/config';
import type { PlanetState } from '../../kernel/state';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { rowOf, setField } from '../../ecs/store';
import { getEnvironment } from '../environment';
import { workerPowerDrain } from '../harvest/workers';
import { applyBrownoutShedding, type ShedCandidate, type SheddingResult } from './shedding';
import { pylonDrainPerS, resolveConsumerDrains } from './drains';
import { type PowerGraph, type PowerGraphComponent } from './graph';
import { evaluateWindOutput } from './windAndCap';
import { stepComponentStores, type HqCellStepResult } from './hqCell';
import { stepThermalPlantFuel } from './thermal';
import { resolvePowerRow, computeSolarOutputPerS } from './index';
import type { EntityPowerStatus, PowerComponentSummary } from './types';
import {
  checkComponentPylonOverload,
  type ComponentOverloadResult,
  type OverloadPylonInfo,
  type PylonLoadInfo,
} from './overload';

export interface ComponentEvalResult {
  summary: PowerComponentSummary;
  genSupply: number;
  effectiveSupply: number;
  demand: number;
  rawDemand: number;
  buildingDemand: number;
  solarGross: number; solarDrain: number; solarNet: number;
  thermalGross: number; thermalDrain: number; thermalNet: number;
  windGross: number; windDrain: number; windNet: number;
  capStoredE: number; capCapacityE: number; capDischargePerS: number; capChargePerS: number;
  /** The HQ cell's part in this component (`hqCell.ts`): linked only in the Hub's component. */
  hqCell: HqCellStepResult;
  unpoweredIds: number[];
  nightSolarIds: number[];
  noFuelIds: number[];
  onlineEntityIds: number[];
  shed: SheddingResult;
  pylonLoads: Record<number, PylonLoadInfo>;
  overloadedPylons: OverloadPylonInfo[];
  overloadedEntityIds: number[];
}

export interface ComponentBuildingsResult {
  genSupply: number;
  compDemand: number;
  solarGross: number; solarDrain: number; solarNet: number;
  thermalGross: number; thermalDrain: number; thermalNet: number;
  windGross: number; windDrain: number; windNet: number;
  capRows: number[];
  shedCandidates: ShedCandidate[];
  nightSolarIds: number[];
  noFuelIds: number[];
  onlineEntityIds: number[];
}

/** The shed group of a building kind: its row's `shedGroup` for consumers, 4 for generators / pylons, else 3. */
export function getShedGroupForEntityKind(kind: number, data?: CompiledDataLike): number {
  const consumer = resolveConsumerDrains(data).get(kind);
  if (consumer) return consumer.group;
  if (kind === ENTITY_KIND.wind || kind === ENTITY_KIND.thermal || kind === ENTITY_KIND.pylon) {
    return 4;
  }
  return 3;
}

export function getComponentSyntheticLoad(colony: unknown, comp: PowerGraphComponent): number {
  const colExt = colony as {
    syntheticLoadPerS?: number;
    extraLoadPerS?: number;
    syntheticLoadEntityId?: number;
    syntheticLoadPylonId?: number;
  } | undefined;
  if (!colExt) return 0;
  const load = Number(colExt.syntheticLoadPerS ?? colExt.extraLoadPerS ?? 0);
  if (load <= 0) return 0;

  const targetId = colExt.syntheticLoadEntityId ?? colExt.syntheticLoadPylonId;
  if (typeof targetId === 'number') {
    const inComp =
      comp.attachedBuildingIds.includes(targetId) ||
      comp.pylonIds.includes(targetId) ||
      comp.hubIds.includes(targetId);
    return inComp ? load : 0;
  }
  if (comp.hasHub || comp.componentId === 0) {
    return load;
  }
  return 0;
}

function isLightningOverloaded(state: PlanetState, entityId: number, tick: number): boolean {
  const map = (state.blobs.weather?.value as { overloadUntilByEntity?: Record<number, number> } | undefined)?.overloadUntilByEntity;
  const until = map?.[entityId];
  return typeof until === 'number' && until > tick;
}

export function evaluateComponentBuildingRows(
  state: PlanetState,
  colonyIndex: number,
  comp: PowerGraphComponent,
  env: ReturnType<typeof getEnvironment>,
  windOut: ReturnType<typeof evaluateWindOutput>,
  dtTicks: number,
  tick: number,
  data?: CompiledDataLike,
): ComponentBuildingsResult {
  const cols = state.entities.cols;
  let genSupply = 0, compDemand = 0;
  let solarGross = 0, solarDrain = 0, solarNet = 0;
  let thermalGross = 0, thermalDrain = 0, thermalNet = 0;
  let windGross = 0, windDrain = 0, windNet = 0;
  const capRows: number[] = [], shedCandidates: ShedCandidate[] = [];
  const nightSolarIds: number[] = [], noFuelIds: number[] = [];
  const onlineEntityIds: number[] = [...comp.hubIds, ...comp.pylonIds].filter((id) => !isLightningOverloaded(state, id, tick));
  const drains = resolveConsumerDrains(data);

  for (const row of comp.attachedBuildingRows) {
    const id = cols.id[row], kind = cols.kind[row];
    let st = cols.state[row];
    if (st === ENTITY_STATE.constructing) continue;
    if (isLightningOverloaded(state, id, tick)) {
      if (st !== ENTITY_STATE.offlineOverload) setField(state.entities, row, 'state', ENTITY_STATE.offlineOverload, tick);
      continue;
    }
    if (st === ENTITY_STATE.offlineOverload) {
      setField(state.entities, row, 'state', ENTITY_STATE.active, tick);
      st = ENTITY_STATE.active;
    }
    if (kind === ENTITY_KIND.solar) {
      const out = computeSolarOutputPerS(env.daylight, state.meta.planetType, data);
      solarGross += out.gross; solarDrain += out.internalDrain; solarNet += out.net;
      if (env.phase === 'night' || env.daylight <= 0.001) nightSolarIds.push(id);
      else if (out.net >= 0) {
        if (st === ENTITY_STATE.offlineUnpowered || st === ENTITY_STATE.offlineNoGrid) {
          setField(state.entities, row, 'state', ENTITY_STATE.active, tick);
        }
        genSupply += out.net; onlineEntityIds.push(id);
      }
    } else if (kind === ENTITY_KIND.wind) {
      windGross += windOut.grossPerS; windDrain += windOut.internalDrainPerS; windNet += windOut.netPerS;
      if (windOut.netPerS > 0) {
        if (st === ENTITY_STATE.offlineUnpowered || st === ENTITY_STATE.offlineNoGrid) {
          setField(state.entities, row, 'state', ENTITY_STATE.active, tick);
        }
        genSupply += windOut.netPerS; onlineEntityIds.push(id);
      } else if (windOut.internalDrainPerS > 0) {
        compDemand += windOut.internalDrainPerS;
        shedCandidates.push({ entityId: id, row, group: 4, drainPerS: windOut.internalDrainPerS, kind });
      }
    } else if (kind === ENTITY_KIND.thermal) {
      const res = stepThermalPlantFuel(state, colonyIndex, row, dtTicks, tick, data);
      if (!res.fueled) noFuelIds.push(id);
      else {
        thermalGross += res.grossPerS; thermalDrain += res.drainPerS; thermalNet += res.netPerS;
        genSupply += res.netPerS; onlineEntityIds.push(id);
      }
    } else if (drains.has(kind)) {
      const tradeRow = kind === ENTITY_KIND.tradeHub ? resolvePowerRow(data, 'tradeHub', `t${cols.tier[row] || 1}`) : null;
      const { drain, group } = tradeRow ? { drain: Number(tradeRow.powerDrainPerS ?? 6), group: Number(tradeRow.shedGroup ?? 2) } : drains.get(kind)!;
      if (kind === ENTITY_KIND.capacitor) capRows.push(row);
      compDemand += drain;
      shedCandidates.push({ entityId: id, row, group, drainPerS: drain, kind });
      onlineEntityIds.push(id);
    }
  }
  return {
    genSupply, compDemand, solarGross, solarDrain, solarNet,
    thermalGross, thermalDrain, thermalNet, windGross, windDrain, windNet,
    capRows, shedCandidates, nightSolarIds, noFuelIds, onlineEntityIds,
  };
}

function computeComponentDemands(
  state: PlanetState,
  colonyIndex: number,
  comp: PowerGraphComponent,
  bRes: ComponentBuildingsResult,
  overloadRes: ComponentOverloadResult,
  unitDemand: number,
  workDemand: number,
  hubDrainPerHub: number,
  data?: CompiledDataLike,
): { compBuildingDemand: number; compUnitDemand: number; compWorkDemand: number; compRawDemand: number } {
  let compBuildingDemand = comp.hubIds.length * hubDrainPerHub + comp.pylonIds.length * pylonDrainPerS(data) + bRes.compDemand;
  if (overloadRes.shedConsumerRows.size > 0) {
    for (const c of bRes.shedCandidates) {
      if (overloadRes.shedConsumerRows.has(c.row)) {
        compBuildingDemand = Math.max(0, Number((compBuildingDemand - c.drainPerS).toFixed(4)));
      }
    }
  }

  const compUnitDemand = comp.hasHub ? unitDemand : 0;
  const compWorkDemand = comp.hasHub ? workDemand : 0;
  let compSyntheticLoad = getComponentSyntheticLoad(state.colonies[colonyIndex], comp);
  if (overloadRes.absorbedSyntheticLoad > 0) {
    compSyntheticLoad = Math.max(0, Number((compSyntheticLoad - overloadRes.absorbedSyntheticLoad).toFixed(4)));
  }
  const compRawDemand = Number((compBuildingDemand + compUnitDemand + compWorkDemand + compSyntheticLoad).toFixed(4));
  return { compBuildingDemand, compUnitDemand, compWorkDemand, compRawDemand };
}

function buildUnpoweredComponentResult(
  state: PlanetState,
  comp: PowerGraphComponent,
  bRes: ComponentBuildingsResult,
  overloadRes: ComponentOverloadResult,
  compRawDemand: number,
  isW03: boolean,
  tick: number,
): ComponentEvalResult {
  const e = state.entities, cols = e.cols;
  const unpoweredIds: number[] = [];
  for (const row of comp.attachedBuildingRows) {
    const id = cols.id[row], kind = cols.kind[row], st = cols.state[row];
    if (st === ENTITY_STATE.constructing) continue;
    if (kind !== ENTITY_KIND.solar && kind !== ENTITY_KIND.wind && kind !== ENTITY_KIND.thermal) {
      unpoweredIds.push(id);
      const targetState = isW03 ? ENTITY_STATE.offlineNoGrid : ENTITY_STATE.offlineUnpowered;
      if (st !== targetState) setField(e, row, 'state', targetState, tick);
    }
  }

  const emptyShed: SheddingResult = {
    shedEntityIds: [],
    shedGroupsActive: [],
    hqFastRechargeShed: false,
    remainingDemand: 0,
    offlineReasons: {},
    shedWorkJobIds: [],
    shedWorkDemand: 0,
  };

  return {
    summary: {
      componentId: comp.componentId, entityIds: [...comp.hubIds, ...comp.pylonIds, ...comp.attachedBuildingIds],
      pylonIds: comp.pylonIds, hasHub: comp.hasHub, supply: 0, demand: 0, rawDemand: compRawDemand, net: 0, powered: false,
      shedEntityIds: [], shedGroupsActive: [], deficitPerS: compRawDemand,
    },
    genSupply: 0, effectiveSupply: 0, demand: 0, rawDemand: compRawDemand, buildingDemand: 0,
    solarGross: bRes.solarGross, solarDrain: bRes.solarDrain, solarNet: bRes.solarNet,
    thermalGross: bRes.thermalGross, thermalDrain: bRes.thermalDrain, thermalNet: bRes.thermalNet,
    windGross: bRes.windGross, windDrain: bRes.windDrain, windNet: bRes.windNet,
    capStoredE: 0, capCapacityE: 0, capDischargePerS: 0, capChargePerS: 0,
    hqCell: { linked: false, storedE: 0, capacityE: 0, dischargePerS: 0, chargePerS: 0 },
    unpoweredIds, nightSolarIds: bRes.nightSolarIds, noFuelIds: bRes.noFuelIds, onlineEntityIds: [],
    shed: emptyShed,
    pylonLoads: overloadRes.pylonLoads,
    overloadedPylons: overloadRes.overloadedPylons,
    overloadedEntityIds: overloadRes.overloadedShedEntityIds,
  };
}

function applyComponentLightningOverload(
  state: PlanetState,
  comp: PowerGraphComponent,
  shed: SheddingResult,
  onlineEntityIds: number[],
  overloadedEntityIds: number[],
  tick: number,
): void {
  const allIds = [...comp.hubIds, ...comp.pylonIds, ...comp.attachedBuildingIds];
  for (const id of allIds) {
    const row = rowOf(state.entities, id);
    if (isLightningOverloaded(state, id, tick)) {
      if (row >= 0 && state.entities.cols.state[row] !== ENTITY_STATE.offlineOverload) {
        setField(state.entities, row, 'state', ENTITY_STATE.offlineOverload, tick);
      }
      shed.offlineReasons[id] = 'offline: lightning overload';
      const idx = onlineEntityIds.indexOf(id);
      if (idx >= 0) onlineEntityIds.splice(idx, 1);
      if (!overloadedEntityIds.includes(id)) overloadedEntityIds.push(id);
    } else if (
      row >= 0 &&
      state.entities.cols.state[row] === ENTITY_STATE.offlineOverload &&
      !overloadedEntityIds.includes(id)
    ) {
      setField(state.entities, row, 'state', ENTITY_STATE.active, tick);
    }
  }
}

export function evaluateSingleComponent(
  state: PlanetState,
  colonyIndex: number,
  comp: PowerGraphComponent,
  graph: PowerGraph,
  env: ReturnType<typeof getEnvironment>,
  windOut: ReturnType<typeof evaluateWindOutput>,
  unitDemand: number,
  work: { demand: number; candidates: ShedCandidate[] },
  hubAnchors: ReadonlyArray<{ q: number; r: number }>,
  dtTicks: number,
  tick: number,
  data?: CompiledDataLike,
): ComponentEvalResult {
  const cols = state.entities.cols;
  const hubRow = resolvePowerRow(data, 'hub', 't1');
  const founderCorePerHub = Number(hubRow.founderCoreGenPerS ?? 8);
  const hubDrainPerHub = Number(hubRow.powerDrainPerS ?? 5);

  const bRes = evaluateComponentBuildingRows(state, colonyIndex, comp, env, windOut, dtTicks, tick, data);
  const override = state.colonies[colonyIndex]?.powerSupplyOverride;
  const hasOverride = typeof override === 'number' && Number.isFinite(override);
  const genSupply = hasOverride ? Math.max(0, override) / Math.max(1, graph.components.length) : comp.hubIds.length * founderCorePerHub + bRes.genSupply;

  const isW03 = Boolean((data?.tables?.grid as Record<string, unknown> | undefined)?.pylon);
  const overloadRes = isW03
    ? checkComponentPylonOverload(state, colonyIndex, comp, graph, bRes, env, windOut, tick, data)
    : { overloadedPylons: [], overloadedShedEntityIds: [], pylonLoads: {}, shedConsumerRows: new Set<number>(), absorbedSyntheticLoad: 0 };

  const { compUnitDemand, compWorkDemand, compRawDemand } = computeComponentDemands(
    state, colonyIndex, comp, bRes, overloadRes, unitDemand, work.demand, hubDrainPerHub, data,
  );

  const hasCapStored = bRes.capRows.some((r) => (cols.cell?.[r] ?? 0) > 0);
  const isPowered = hasOverride || genSupply > 0 || hasCapStored;

  if (!isPowered) {
    const unpoweredRes = buildUnpoweredComponentResult(state, comp, bRes, overloadRes, compRawDemand, isW03, tick);
    applyComponentLightningOverload(state, comp, unpoweredRes.shed, unpoweredRes.onlineEntityIds, unpoweredRes.overloadedEntityIds, tick);
    return unpoweredRes;
  }

  const { hqCell, capRes, effectiveSupply: storedSupply } = stepComponentStores(
    state, colonyIndex, comp.hasHub, hubAnchors, bRes.capRows, hasOverride ? compRawDemand : genSupply, compRawDemand, hasOverride ? 0 : dtTicks, tick, data,
  );

  const effectiveSupply = hasOverride ? genSupply : storedSupply;
  const remainingCandidates = bRes.shedCandidates.filter((c) => !overloadRes.shedConsumerRows.has(c.row));
  const compWorkCandidates = comp.hasHub ? work.candidates : [];
  const compCandidates = [...remainingCandidates, ...compWorkCandidates];
  const compAnchors = comp.hasHub ? hubAnchors : [];
  const shed = applyBrownoutShedding(state, colonyIndex, effectiveSupply, compRawDemand, compCandidates, compAnchors, tick, data);

  for (const id of overloadRes.overloadedShedEntityIds) {
    shed.offlineReasons[id] = 'offline: overload';
  }
  const overloadedEntityIds = [...overloadRes.overloadedShedEntityIds];
  applyComponentLightningOverload(state, comp, shed, bRes.onlineEntityIds, overloadedEntityIds, tick);
  const totalShedEntityIds = [...overloadRes.overloadedShedEntityIds, ...shed.shedEntityIds];

  const compRemainingDemand = shed.remainingDemand;
  const compNet = Number((effectiveSupply - compRemainingDemand).toFixed(4));
  const deficitPerS = Math.max(0, Number((compRawDemand - effectiveSupply).toFixed(4)));
  const compBuildingRemainingDemand = Math.max(
    0,
    Number((compRemainingDemand - compUnitDemand - (compWorkDemand - shed.shedWorkDemand)).toFixed(4)),
  );

  return {
    summary: {
      componentId: comp.componentId, entityIds: [...comp.hubIds, ...comp.pylonIds, ...comp.attachedBuildingIds],
      pylonIds: comp.pylonIds, hasHub: comp.hasHub, supply: effectiveSupply, demand: compRemainingDemand, rawDemand: compRawDemand,
      net: compNet, powered: true, shedEntityIds: totalShedEntityIds, shedGroupsActive: shed.shedGroupsActive, deficitPerS,
    },
    genSupply, effectiveSupply, demand: compRemainingDemand, rawDemand: compRawDemand, buildingDemand: compBuildingRemainingDemand,
    solarGross: bRes.solarGross, solarDrain: bRes.solarDrain, solarNet: bRes.solarNet,
    thermalGross: bRes.thermalGross, thermalDrain: bRes.thermalDrain, thermalNet: bRes.thermalNet,
    windGross: bRes.windGross, windDrain: bRes.windDrain, windNet: bRes.windNet,
    capStoredE: capRes.storedE, capCapacityE: capRes.capacityE, capDischargePerS: capRes.dischargePerS, capChargePerS: capRes.chargePerS,
    hqCell,
    unpoweredIds: [], nightSolarIds: bRes.nightSolarIds, noFuelIds: bRes.noFuelIds, onlineEntityIds: bRes.onlineEntityIds,
    shed,
    pylonLoads: overloadRes.pylonLoads,
    overloadedPylons: overloadRes.overloadedPylons,
    overloadedEntityIds,
  };
}

export function processUnattachedBuildings(
  state: PlanetState,
  graph: PowerGraph,
  tick: number,
  unpoweredEntityIds: number[],
  offlineReasons: Record<number, string>,
  entityPower: Record<number, EntityPowerStatus>,
  data?: CompiledDataLike,
): void {
  const isW03 = Boolean((data?.tables?.grid as Record<string, unknown> | undefined)?.pylon);
  const e = state.entities, cols = e.cols;
  for (const row of graph.unattachedBuildingRows) {
    const id = cols.id[row], kind = cols.kind[row], st = cols.state[row];
    if (st === ENTITY_STATE.constructing) continue;
    unpoweredEntityIds.push(id);
    if (isLightningOverloaded(state, id, tick)) {
      if (st !== ENTITY_STATE.offlineOverload) setField(e, row, 'state', ENTITY_STATE.offlineOverload, tick);
      offlineReasons[id] = 'offline: lightning overload';
      entityPower[id] = { state: 'offline', reason: 'offline: lightning overload', component: -1, overloaded: true } as EntityPowerStatus;
      continue;
    }
    const isGen = kind === ENTITY_KIND.solar || kind === ENTITY_KIND.wind || kind === ENTITY_KIND.thermal;
    const targetState = (!isGen && isW03) ? ENTITY_STATE.offlineNoGrid : ENTITY_STATE.offlineUnpowered;
    if (st !== targetState) {
      setField(e, row, 'state', targetState, tick);
    }
    const reason = isGen ? 'offline: unpowered' : 'offline: no grid';
    offlineReasons[id] = reason;
    entityPower[id] = { state: 'offline', reason, component: -1 };
  }
}

export function calculateUnitDemand(
  state: PlanetState,
  colonyIndex: number,
  data?: CompiledDataLike,
): number {
  const dayCycleRow = resolvePowerRow(data, 'economyT1Basic', 'dayCycle');
  const idleMult = Number(dayCycleRow.unitIdleDrainMult ?? 0.5);
  let unitDemand = 0;
  const cols = state.entities.cols;
  for (let r = 0; r < state.entities.count; r++) {
    if (cols.owner[r] !== colonyIndex || cols.hp[r] <= 0) continue;
    const k = cols.kind[r], st = cols.state[r];
    if (k !== ENTITY_KIND.worker) continue;
    const drain = workerPowerDrain(cols.tier[r] || 1, data);
    const idle = st === ENTITY_STATE.idle || st === ENTITY_STATE.offlineBrownout;
    unitDemand += idle ? drain * idleMult : drain;
  }
  return unitDemand;
}

export function applyOfflineStatuses(
  graph: PowerGraph,
  unpoweredEntityIds: number[],
  nightSolarEntityIds: number[],
  noFuelEntityIds: number[],
  shedEntityIds: number[],
  overloadedEntityIds: number[],
  offlineReasons: Record<number, string>,
  entityPower: Record<number, EntityPowerStatus>,
): void {
  for (const id of unpoweredEntityIds) {
    if (!offlineReasons[id]) {
      offlineReasons[id] = 'offline: no grid';
      const cId = graph.componentByBuildingId.get(id) ?? -1;
      entityPower[id] = { state: 'offline', reason: 'offline: no grid', component: cId };
    }
  }
  for (const id of nightSolarEntityIds) {
    offlineReasons[id] = 'offline: night';
    entityPower[id] = { state: 'offline', reason: 'offline: night', component: graph.componentByBuildingId.get(id) ?? -1 };
  }
  for (const id of noFuelEntityIds) {
    offlineReasons[id] = 'offline: no fuel';
    entityPower[id] = { state: 'offline', reason: 'offline: no fuel', component: graph.componentByBuildingId.get(id) ?? -1 };
  }
  for (const id of shedEntityIds) {
    entityPower[id] = { state: 'offline', reason: 'offline: brownout', component: graph.componentByBuildingId.get(id) ?? -1 };
  }
  for (const id of overloadedEntityIds) {
    const isLightning = offlineReasons[id] === 'offline: lightning overload';
    const reason = isLightning ? 'offline: lightning overload' : 'offline: overload';
    offlineReasons[id] = reason;
    const cId = graph.componentByBuildingId.get(id) ?? graph.componentByRelayId.get(id) ?? -1;
    entityPower[id] = {
      state: 'offline',
      reason,
      component: cId,
      ...(isLightning ? { overloaded: true } : {}),
    } as EntityPowerStatus;
  }
}
