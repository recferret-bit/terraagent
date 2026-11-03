import { compileData, dataRow, type CompiledRow } from '../../data';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { setField } from '../../ecs/store';
import { hexDistance } from '../../grid/hex';
import type { CompiledDataLike } from '../../kernel/config';
import { setBlob, type PlanetState, type PlanetType } from '../../kernel/state';
import { defineSystem } from '../../kernel/system';
import { defineSimModule } from '../define';
import { getEnvironment } from '../environment';
import { applyBrownoutShedding, type ShedCandidate } from './shedding';
import { evaluatePowerEventsForColony, type PowerEventTracker } from './events';
import { collectWorkLoad } from './workLoad';

export * from './shedding';
export * from './solar';
export * from './events';
export { collectWorkLoad, terraformOpShedGroup, type WorkLoad } from './workLoad';

export interface BuildingFootprintTile {
  q: number;
  r: number;
}

export interface ColonyPowerSummary {
  colonyIndex: number;
  hasHub: boolean;
  founderCorePerS: number;
  solarGrossPerS: number;
  solarInternalDrainPerS: number;
  solarNetPerS: number;
  supply: number;
  demand: number;
  rawDemand: number;
  buildingDemand: number;
  unitDemand: number;
  /** E/s the colony's player work jobs (TERRAFORM / REPAIR) draw now, after shedding (`UO-TF-02`). */
  workDemand: number;
  net: number;
  brownout: boolean;
  shedGroupsActive: number[];
  shedEntityIds: number[];
  /** Work jobs paused by the brownout (shed group 1): `waiting (power)`, progress kept, resumed when power returns. */
  shedWorkJobIds: string[];
  unpoweredEntityIds: number[];
  hqFastRechargeShed: boolean;
  offlineReasons: Record<number, string>;
  daylight: number;
  phase: 'day' | 'night';
  clockText: string;
}

let cachedW02Data: CompiledDataLike | null = null;
function defaultW02Data(): CompiledDataLike {
  if (!cachedW02Data) cachedW02Data = compileData(new Set(['W00', 'W01', 'W02', 'W10']));
  return cachedW02Data;
}

export function resolvePowerRow(data: CompiledDataLike | undefined, table: string, id: string): CompiledRow {
  const t = data?.tables?.[table] as Record<string, CompiledRow> | undefined;
  if (t?.[id]) return t[id];
  return dataRow(defaultW02Data(), table, id);
}

/** Computes the axial tiles covered by an entity with anchor `(q, r)` and footprint `(w, d)`. */
export function getEntityFootprintTiles(q: number, r: number, w: number, d: number, rot = 0): BuildingFootprintTile[] {
  const width = Math.max(1, w || 1);
  const depth = Math.max(1, d || 1);
  const swap = rot % 2 !== 0;
  const fw = swap ? depth : width;
  const fd = swap ? width : depth;
  const minQ = -Math.floor((fw - 1) / 2);
  const minR = -Math.floor((fd - 1) / 2);
  const tiles: BuildingFootprintTile[] = [];
  for (let dr = 0; dr < fd; dr++) {
    for (let dq = 0; dq < fw; dq++) {
      tiles.push({ q: q + minQ + dq, r: r + minR + dr });
    }
  }
  return tiles;
}

/** Minimum hex distance between any tile of `a` and any tile of `b`. */
export function minFootprintDistance(a: readonly BuildingFootprintTile[], b: readonly BuildingFootprintTile[]): number {
  let best = Infinity;
  for (const ta of a) {
    for (const tb of b) {
      const dist = hexDistance(ta.q, ta.r, tb.q, tb.r);
      if (dist < best) best = dist;
    }
  }
  return best;
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

interface HubPylonNetwork {
  hasHub: boolean;
  hubCount: number;
  pylonTiles: BuildingFootprintTile[];
  hubAnchors: BuildingFootprintTile[];
  span: number;
  attachRadius: number;
}

function collectHubPylons(state: PlanetState, colonyIndex: number, hubRow: CompiledRow, attachRadius: number): HubPylonNetwork {
  const e = state.entities, cols = e.cols;
  const pylonTiles: BuildingFootprintTile[] = [];
  const hubAnchors: BuildingFootprintTile[] = [];
  let hubCount = 0;
  for (let row = 0; row < e.count; row++) {
    if (cols.owner[row] !== colonyIndex || cols.hp[row] <= 0) continue;
    if (cols.kind[row] !== ENTITY_KIND.commandHub || cols.state[row] === ENTITY_STATE.constructing) continue;
    hubCount++;
    const w = cols.footprintW?.[row] || Number(hubRow.footprintW ?? 3);
    const d = cols.footprintD?.[row] || Number(hubRow.footprintD ?? 3);
    hubAnchors.push({ q: cols.q[row], r: cols.r[row] });
    pylonTiles.push(...getEntityFootprintTiles(cols.q[row], cols.r[row], w, d, cols.rot[row]));
  }
  return { hasHub: hubCount > 0, hubCount, pylonTiles, hubAnchors, span: Number(hubRow.pylonSpan ?? 6), attachRadius };
}

function isRowAttachedToPylons(state: PlanetState, row: number, defaultW: number, defaultD: number, net: HubPylonNetwork): boolean {
  if (!net.hasHub) return true;
  const cols = state.entities.cols;
  const w = cols.footprintW?.[row] || defaultW;
  const d = cols.footprintD?.[row] || defaultD;
  const tiles = getEntityFootprintTiles(cols.q[row], cols.r[row], w, d, cols.rot[row]);
  if (minFootprintDistance(tiles, net.pylonTiles) <= net.attachRadius) return true;
  for (const h of net.hubAnchors) {
    if (minFootprintDistance(tiles, [h]) <= net.span) return true;
  }
  return false;
}

function resolveTradeHubPowerRow(tier: number, data?: CompiledDataLike): CompiledRow {
  const tierId = tier === 3 ? 't3' : tier === 2 ? 't2' : 't1';
  return resolvePowerRow(data, 'tradeHub', tierId);
}

function evaluateDrainBuildingRow(
  state: PlanetState,
  row: number,
  buildingRow: CompiledRow,
  defaultGroup: number,
  netInfo: HubPylonNetwork,
  unpoweredEntityIds: number[],
  shedCandidates: ShedCandidate[],
  tick: number,
): number {
  const e = state.entities, cols = e.cols, st = cols.state[row];
  const defW = Number(buildingRow.footprintW ?? buildingRow.footprint ?? 2);
  const defD = Number(buildingRow.footprintD ?? buildingRow.footprint ?? 2);
  if (!isRowAttachedToPylons(state, row, defW, defD, netInfo)) {
    unpoweredEntityIds.push(cols.id[row]);
    if (st !== ENTITY_STATE.offlineUnpowered) setField(e, row, 'state', ENTITY_STATE.offlineUnpowered, tick);
    return 0;
  }
  if (st === ENTITY_STATE.offlineUnpowered) setField(e, row, 'state', ENTITY_STATE.active, tick);
  const drain = Number(buildingRow.powerDrainPerS ?? 6);
  const group = cols.shedGroup?.[row] || Number(buildingRow.shedGroup ?? defaultGroup);
  shedCandidates.push({ entityId: cols.id[row], row, group, drainPerS: drain, kind: cols.kind[row] });
  return drain;
}

/** Evaluates single-component colony power and applies brownout shedding (W02-05, W02-06, W10-04). */
export function evaluateColonyPower(
  state: PlanetState,
  colonyIndex: number,
  data?: CompiledDataLike,
  tick: number = state.meta.tick,
): ColonyPowerSummary {
  const hubRow = resolvePowerRow(data, 'hub', 't1');
  const extractorRow = resolvePowerRow(data, 'economyT1Basic', 'metalsExtractor');
  const harvesterRow = resolvePowerRow(data, 'unitsWorkersBasic', 'harvester');
  const dayCycleRow = resolvePowerRow(data, 'economyT1Basic', 'dayCycle');
  const attachRadius = Number(dayCycleRow.pylonAttachRadius ?? 3);
  const idleDrainMult = Number(dayCycleRow.unitIdleDrainMult ?? 0.5);

  const env = getEnvironment(state, data);
  const netInfo = collectHubPylons(state, colonyIndex, hubRow, attachRadius);
  const founderCorePerS = netInfo.hasHub ? Number(hubRow.founderCoreGenPerS ?? 8) * netInfo.hubCount : 0;
  const hubDrainPerS = netInfo.hasHub ? Number(hubRow.powerDrainPerS ?? 5) * netInfo.hubCount : 0;

  let solarGrossPerS = 0, solarInternalDrainPerS = 0, solarNetPerS = 0, onlineGen = 0;
  let rawBuildingDemand = hubDrainPerS, unitDemand = 0;
  const unpoweredEntityIds: number[] = [];
  const nightSolarEntityIds: number[] = [];
  const shedCandidates: ShedCandidate[] = [];
  const e = state.entities, cols = e.cols;

  for (let row = 0; row < e.count; row++) {
    if (cols.owner[row] !== colonyIndex || cols.hp[row] <= 0) continue;
    const kind = cols.kind[row], st = cols.state[row];

    if (kind === ENTITY_KIND.solar && st !== ENTITY_STATE.constructing) {
      if (!isRowAttachedToPylons(state, row, 2, 2, netInfo)) {
        unpoweredEntityIds.push(cols.id[row]);
        if (st !== ENTITY_STATE.offlineUnpowered) setField(e, row, 'state', ENTITY_STATE.offlineUnpowered, tick);
        continue;
      }
      if (st === ENTITY_STATE.offlineUnpowered) setField(e, row, 'state', ENTITY_STATE.active, tick);
      const out = computeSolarOutputPerS(env.daylight, state.meta.planetType, data);
      solarGrossPerS += out.gross; solarInternalDrainPerS += out.internalDrain; solarNetPerS += out.net;
      if (env.phase === 'night' || env.daylight <= 0.001) {
        nightSolarEntityIds.push(cols.id[row]);
      } else if (out.net >= 0) {
        onlineGen += out.net;
      }
    } else if (kind === ENTITY_KIND.metalsExtractor && st !== ENTITY_STATE.constructing) {
      rawBuildingDemand += evaluateDrainBuildingRow(state, row, extractorRow, 3, netInfo, unpoweredEntityIds, shedCandidates, tick);
    } else if (kind === ENTITY_KIND.tradeHub && st !== ENTITY_STATE.constructing) {
      const tradeHubRow = resolveTradeHubPowerRow(cols.tier?.[row] || 1, data);
      rawBuildingDemand += evaluateDrainBuildingRow(state, row, tradeHubRow, 2, netInfo, unpoweredEntityIds, shedCandidates, tick);
    } else if (kind === ENTITY_KIND.harvester) {
      const fullDrain = Number(harvesterRow.powerDrainPerS ?? 1.5);
      const isIdle = st === ENTITY_STATE.idle || st === ENTITY_STATE.offlineBrownout;
      unitDemand += isIdle ? fullDrain * idleDrainMult : fullDrain;
    }
  }

  // Player work jobs draw from the grid (shed group 1); before the Hub there is no grid and they stay unmetered (GP-45).
  const work = netInfo.hasHub ? collectWorkLoad(state, colonyIndex, data) : { demand: 0, candidates: [] };
  shedCandidates.push(...work.candidates);

  const supply = Number((founderCorePerS + onlineGen).toFixed(4));
  const rawDemand = Number((rawBuildingDemand + unitDemand + work.demand).toFixed(4));
  const effectiveSupply = Math.max(0, Number((supply + Math.min(0, solarNetPerS)).toFixed(4)));

  const shed = applyBrownoutShedding(
    state, colonyIndex, effectiveSupply, rawDemand, shedCandidates, netInfo.hubAnchors, tick, data,
  );
  for (const id of unpoweredEntityIds) shed.offlineReasons[id] = 'offline: unpowered';
  for (const id of nightSolarEntityIds) shed.offlineReasons[id] = 'offline: night';

  const demand = shed.remainingDemand;
  const workDemand = Math.max(0, Number((work.demand - shed.shedWorkDemand).toFixed(4)));
  const buildingDemand = Math.max(0, Number((demand - unitDemand - workDemand).toFixed(4)));
  const net = Number((effectiveSupply - demand).toFixed(4));

  return {
    colonyIndex, hasHub: netInfo.hasHub, founderCorePerS,
    solarGrossPerS: Number(solarGrossPerS.toFixed(4)),
    solarInternalDrainPerS: Number(solarInternalDrainPerS.toFixed(4)),
    solarNetPerS: Number(solarNetPerS.toFixed(4)),
    supply, demand, rawDemand, buildingDemand,
    unitDemand: Number(unitDemand.toFixed(4)), workDemand,
    net, brownout: shed.shedEntityIds.length > 0 || shed.shedWorkJobIds.length > 0 || rawDemand > effectiveSupply + 1e-6,
    shedGroupsActive: shed.shedGroupsActive,
    shedEntityIds: shed.shedEntityIds,
    shedWorkJobIds: shed.shedWorkJobIds,
    unpoweredEntityIds,
    hqFastRechargeShed: shed.hqFastRechargeShed,
    offlineReasons: shed.offlineReasons,
    daylight: env.daylight, phase: env.phase, clockText: env.clockText,
  };
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
): Record<number, ColonyPowerSummary> {
  const prevTrackers = (state.blobs.power?.value as { trackers?: Record<number, PowerEventTracker> } | undefined)?.trackers ?? {};
  const byColony: Record<number, ColonyPowerSummary> = {};
  const colonyIndices = new Set<number>();
  for (const c of state.colonies) colonyIndices.add(c.index);
  for (let row = 0; row < state.entities.count; row++) colonyIndices.add(state.entities.cols.owner[row]);
  if (colonyIndices.size === 0) colonyIndices.add(0);

  for (const idx of colonyIndices) {
    const summary = evaluateColonyPower(state, idx, data, tick);
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
      const summary = evaluateColonyPower(state, idx, ctx.data, ctx.tick);
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
