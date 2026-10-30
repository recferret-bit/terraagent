import { compileData, dataRow, type CompiledRow } from '../../data';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { setField } from '../../ecs/store';
import { hexDistance } from '../../grid/hex';
import type { CompiledDataLike } from '../../kernel/config';
import { setBlob, type PlanetState, type PlanetType } from '../../kernel/state';
import { defineSystem } from '../../kernel/system';
import { defineSimModule } from '../define';
import { getEnvironment } from '../environment';

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
  net: number;
  brownout: boolean;
  shedGroupsActive: number[];
  shedEntityIds: number[];
  unpoweredEntityIds: number[];
  daylight: number;
  phase: 'day' | 'night';
  clockText: string;
}

let cachedW02Data: CompiledDataLike | null = null;
function defaultW02Data(): CompiledDataLike {
  if (!cachedW02Data) cachedW02Data = compileData(new Set(['W00', 'W01', 'W02']));
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
  const tiles: BuildingFootprintTile[] = [];
  for (let dr = 0; dr < fd; dr++) {
    for (let dq = 0; dq < fw; dq++) {
      tiles.push({ q: q + dq, r: r + dr });
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

/** Evaluates single-component colony power (W02-05). */
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
  let buildingDemand = hubDrainPerS, rawBuildingDemand = hubDrainPerS, unitDemand = 0;
  const unpoweredEntityIds: number[] = [];
  const shedEntityIds: number[] = [];
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
      if (out.net >= 0) onlineGen += out.net; else rawBuildingDemand += Math.abs(out.net);
    } else if (kind === ENTITY_KIND.metalsExtractor && st !== ENTITY_STATE.constructing) {
      const drain = Number(extractorRow.powerDrainPerS ?? 6);
      if (!isRowAttachedToPylons(state, row, Number(extractorRow.footprintW ?? 2), Number(extractorRow.footprintD ?? 2), netInfo)) {
        unpoweredEntityIds.push(cols.id[row]);
        if (st !== ENTITY_STATE.offlineUnpowered) setField(e, row, 'state', ENTITY_STATE.offlineUnpowered, tick);
        continue;
      }
      rawBuildingDemand += drain;
      if (st === ENTITY_STATE.offlineBrownout) shedEntityIds.push(cols.id[row]);
      else {
        if (st === ENTITY_STATE.offlineUnpowered) setField(e, row, 'state', ENTITY_STATE.active, tick);
        buildingDemand += drain;
      }
    } else if (kind === ENTITY_KIND.harvester) {
      const fullDrain = Number(harvesterRow.powerDrainPerS ?? 1.5);
      const isIdle = st === ENTITY_STATE.idle || st === ENTITY_STATE.offlineBrownout;
      unitDemand += isIdle ? fullDrain * idleDrainMult : fullDrain;
    }
  }

  const supply = Number((founderCorePerS + onlineGen).toFixed(4));
  const demand = Number((buildingDemand + unitDemand).toFixed(4));
  const rawDemand = Number((rawBuildingDemand + unitDemand).toFixed(4));
  const net = Number((supply - demand + Math.min(0, solarNetPerS)).toFixed(4));

  return {
    colonyIndex, hasHub: netInfo.hasHub, founderCorePerS,
    solarGrossPerS: Number(solarGrossPerS.toFixed(4)),
    solarInternalDrainPerS: Number(solarInternalDrainPerS.toFixed(4)),
    solarNetPerS: Number(solarNetPerS.toFixed(4)),
    supply, demand, rawDemand,
    buildingDemand: Number(buildingDemand.toFixed(4)),
    unitDemand: Number(unitDemand.toFixed(4)),
    net, brownout: rawDemand > supply + 1e-6 || shedEntityIds.length > 0,
    shedGroupsActive: shedEntityIds.length > 0 ? [3] : [],
    shedEntityIds, unpoweredEntityIds,
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

const powerCoreSystem = defineSystem({
  id: 'power.core',
  slot: 7,
  wave: 'W02',
  run(state, ctx) {
    const byColony: Record<number, ColonyPowerSummary> = {};
    const colonyIndices = new Set<number>();
    for (const c of state.colonies) colonyIndices.add(c.index);
    for (let row = 0; row < state.entities.count; row++) colonyIndices.add(state.entities.cols.owner[row]);
    if (colonyIndices.size === 0) colonyIndices.add(0);

    for (const idx of colonyIndices) {
      const summary = evaluateColonyPower(state, idx, ctx.data, ctx.tick);
      byColony[idx] = summary;
      const col = state.colonies[idx];
      if (col) { col.power = summary; col.changedAt = ctx.tick; }
    }
    setBlob(state, 'power', { byColony }, ctx.tick);
  },
});

export default defineSimModule({
  id: 'power-core',
  wave: 'W02',
  systems: [powerCoreSystem],
});
