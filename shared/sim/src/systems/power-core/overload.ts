import type { CompiledDataLike } from '../../kernel/config';
import type { PlanetState } from '../../kernel/state';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { setField } from '../../ecs/store';
import { type ShedCandidate } from './shedding';
import { minFootprintDistance, type PowerGraph, type PowerGraphComponent, type RelayNode } from './graph';
import { resolvePowerRow, computeSolarOutputPerS, type ComponentBuildingsResult } from './index';
import { stepThermalPlantFuel } from './thermal';
import { capacitorMaxDischargePerS, pylonDrainPerS } from './drains';
import { evaluateWindOutput } from './windAndCap';

export interface OverloadPylonInfo {
  pylonId: number;
  flowPerS: number;
  maxLoadPerS: number;
  shedEntityIds: number[];
}

export interface PylonLoadInfo {
  flow: number;
  max: number;
  overloaded: boolean;
  shedEntityIds?: number[];
}

export interface ComponentOverloadResult {
  overloadedPylons: OverloadPylonInfo[];
  overloadedShedEntityIds: number[];
  pylonLoads: Record<number, PylonLoadInfo>;
  shedConsumerRows: Set<number>;
  absorbedSyntheticLoad: number;
}

export interface EnvironmentLike {
  daylight: number;
}

export function findHighestNetGeneratorRelayId(
  state: PlanetState,
  colonyIndex: number,
  comp: PowerGraphComponent,
  graph: PowerGraph,
  env: EnvironmentLike,
  windOut: ReturnType<typeof evaluateWindOutput>,
  tick: number,
  data?: CompiledDataLike,
): number {
  const hubRow = resolvePowerRow(data, 'hub', 't1');
  const founderCorePerHub = Number(hubRow.founderCoreGenPerS ?? 8);

  let bestNet = -Infinity;
  let bestId = Infinity;
  let bestRelayId = comp.hubIds[0] ?? comp.pylonIds[0] ?? 0;

  for (const hId of comp.hubIds) {
    if (founderCorePerHub > bestNet || (founderCorePerHub === bestNet && hId < bestId)) {
      bestNet = founderCorePerHub;
      bestId = hId;
      bestRelayId = hId;
    }
  }

  const cols = state.entities.cols;
  for (const row of comp.attachedBuildingRows) {
    const id = cols.id[row], kind = cols.kind[row], st = cols.state[row];
    if (st === ENTITY_STATE.constructing || st === ENTITY_STATE.offlineUnpowered || st === ENTITY_STATE.offlineNoGrid) continue;
    let net = 0;
    if (kind === ENTITY_KIND.solar) {
      net = computeSolarOutputPerS(env.daylight, state.meta.planetType, data).net;
    } else if (kind === ENTITY_KIND.wind) {
      net = windOut.netPerS;
    } else if (kind === ENTITY_KIND.thermal) {
      const res = stepThermalPlantFuel(state, colonyIndex, row, 0, tick, data);
      if (res.fueled) net = res.netPerS;
    } else if (kind === ENTITY_KIND.capacitor) {
      net = (cols.cell?.[row] ?? 0) > 0 ? capacitorMaxDischargePerS(data) : 0;
    }
    if (net > 0 && (net > bestNet || (net === bestNet && id < bestId))) {
      const rId = graph.attachedRelayByBuildingId.get(id);
      if (typeof rId === 'number') {
        bestNet = net;
        bestId = id;
        bestRelayId = rId;
      }
    }
  }

  return bestRelayId;
}

interface TreeStructure {
  bfsOrder: number[];
  reverseBfs: number[];
  parent: Map<number, number | null>;
  children: Map<number, number[]>;
  depth: Map<number, number>;
}

export function buildSpanningTree(
  compRelays: RelayNode[],
  rootRelayId: number,
): TreeStructure {
  const adj = new Map<number, number[]>();
  for (const r of compRelays) adj.set(r.id, []);
  for (let i = 0; i < compRelays.length; i++) {
    for (let j = i + 1; j < compRelays.length; j++) {
      const a = compRelays[i], b = compRelays[j];
      if (minFootprintDistance(a.footprintTiles, b.footprintTiles) <= Math.max(a.span, b.span)) {
        adj.get(a.id)!.push(b.id);
        adj.get(b.id)!.push(a.id);
      }
    }
  }

  const visited = new Set<number>();
  const parent = new Map<number, number | null>();
  const children = new Map<number, number[]>();
  const depth = new Map<number, number>();
  for (const r of compRelays) children.set(r.id, []);

  const startId = adj.has(rootRelayId) ? rootRelayId : (compRelays[0]?.id ?? 0);
  const queue = [startId];
  visited.add(startId);
  parent.set(startId, null);
  depth.set(startId, 0);
  const bfsOrder: number[] = [];

  while (queue.length > 0) {
    const curr = queue.shift()!;
    bfsOrder.push(curr);
    const nbrs = (adj.get(curr) ?? []).filter((id) => !visited.has(id)).sort((a, b) => a - b);
    for (const nbr of nbrs) {
      visited.add(nbr);
      parent.set(nbr, curr);
      depth.set(nbr, (depth.get(curr) ?? 0) + 1);
      children.get(curr)!.push(nbr);
      queue.push(nbr);
    }
  }

  return { bfsOrder, reverseBfs: [...bfsOrder].reverse(), parent, children, depth };
}

function resolveSyntheticLoadTarget(
  colony: unknown,
  comp: PowerGraphComponent,
  tree: TreeStructure,
  graph: PowerGraph,
  consumersByRelay: Map<number, ShedCandidate[]>,
  rootRelayId: number,
): { synthLoad: number; synthTargetId: number } {
  const colExt = colony as {
    syntheticLoadPerS?: number;
    extraLoadPerS?: number;
    syntheticLoadEntityId?: number;
    syntheticLoadPylonId?: number;
  } | undefined;
  const synthLoad = Number(colExt?.syntheticLoadPerS ?? colExt?.extraLoadPerS ?? 0);
  if (synthLoad <= 0) return { synthLoad: 0, synthTargetId: rootRelayId };

  const targetId = colExt?.syntheticLoadEntityId ?? colExt?.syntheticLoadPylonId;
  if (typeof targetId === 'number') {
    if (tree.children.has(targetId)) return { synthLoad, synthTargetId: targetId };
    const rId = graph.attachedRelayByBuildingId.get(targetId);
    if (typeof rId === 'number') return { synthLoad, synthTargetId: rId };
  }

  if (comp.pylonIds.length > 0) {
    const withConsumers = comp.pylonIds.filter((p) => (consumersByRelay.get(p)?.length ?? 0) > 0);
    const pool = withConsumers.length > 0 ? withConsumers : comp.pylonIds;
    let bestP = pool[0];
    let bestD = tree.depth.get(bestP) ?? 0;
    for (const p of pool) {
      const d = tree.depth.get(p) ?? 0;
      if (d > bestD || (d === bestD && p > bestP)) {
        bestD = d;
        bestP = p;
      }
    }
    return { synthLoad, synthTargetId: bestP };
  }

  return { synthLoad, synthTargetId: rootRelayId };
}

function computeRelayFlows(
  compRelays: RelayNode[],
  tree: TreeStructure,
  consumersByRelay: Map<number, ShedCandidate[]>,
  synthTargetId: number,
  synthLoad: number,
  explicitSynthTarget: boolean,
  hubMax: number,
  pylonMax: number,
  pylonDrain: number,
): { localLoad: Map<number, number>; flow: Map<number, number>; maxLoads: Map<number, number> } {
  const localLoad = new Map<number, number>();
  const maxLoads = new Map<number, number>();
  const relayById = new Map<number, RelayNode>();
  for (const r of compRelays) {
    relayById.set(r.id, r);
    const isPylon = r.kind === ENTITY_KIND.pylon;
    const maxL = isPylon ? pylonMax : hubMax;
    maxLoads.set(r.id, maxL);
    let l = isPylon ? pylonDrain : 0;
    if (r.id === synthTargetId && (isPylon || explicitSynthTarget)) l += synthLoad;
    for (const c of consumersByRelay.get(r.id) ?? []) l += c.drainPerS;
    localLoad.set(r.id, Number(l.toFixed(4)));
  }

  const flow = new Map<number, number>();
  for (const u of tree.reverseBfs) {
    const isPylon = relayById.get(u)?.kind === ENTITY_KIND.pylon;
    let f = localLoad.get(u) ?? 0;
    for (const ch of tree.children.get(u) ?? []) {
      let chFlow = flow.get(ch) ?? 0;
      if (!isPylon && !explicitSynthTarget && synthLoad > 0) {
        chFlow = Math.max(0, chFlow - synthLoad);
      }
      f += chFlow;
    }
    flow.set(u, Number(f.toFixed(4)));
  }

  return { localLoad, flow, maxLoads };
}

function shedSubtreeConsumers(
  u: number,
  maxL: number,
  tree: TreeStructure,
  flow: Map<number, number>,
  consumersByRelay: Map<number, ShedCandidate[]>,
  shedConsumerRows: Set<number>,
  overloadedShedEntityIds: number[],
  pylonShedMap: Map<number, number[]>,
  state: PlanetState,
  tick: number,
): void {
  const subtreeConsumers: ShedCandidate[] = [];
  const subQueue = [u];
  while (subQueue.length > 0) {
    const curr = subQueue.shift()!;
    for (const c of consumersByRelay.get(curr) ?? []) {
      if (!shedConsumerRows.has(c.row)) subtreeConsumers.push(c);
    }
    for (const ch of tree.children.get(curr) ?? []) subQueue.push(ch);
  }

  subtreeConsumers.sort((a, b) => (a.group !== b.group ? a.group - b.group : b.entityId - a.entityId));

  for (const c of subtreeConsumers) {
    if ((flow.get(u) ?? 0) <= maxL + 1e-6) break;
    shedConsumerRows.add(c.row);
    overloadedShedEntityIds.push(c.entityId);
    pylonShedMap.get(u)!.push(c.entityId);
    setField(state.entities, c.row, 'state', ENTITY_STATE.offlineOverload, tick);

    let p: number | null = u;
    while (p !== null) {
      flow.set(p, Number((flow.get(p)! - c.drainPerS).toFixed(4)));
      p = tree.parent.get(p) ?? null;
    }
  }
}

export function checkComponentPylonOverload(
  state: PlanetState,
  colonyIndex: number,
  comp: PowerGraphComponent,
  graph: PowerGraph,
  bRes: ComponentBuildingsResult,
  env: EnvironmentLike,
  windOut: ReturnType<typeof evaluateWindOutput>,
  tick: number,
  data?: CompiledDataLike,
): ComponentOverloadResult {
  const hubRow = resolvePowerRow(data, 'hub', 't1');
  const pylonRow = resolvePowerRow(data, 'grid', 'pylon');
  const hubMax = Number(hubRow.maxLoadPerS ?? hubRow.pylonMaxLoad ?? 150);
  const pylonMax = Number(pylonRow.maxLoadPerS ?? 80);

  const compRelays = graph.relayNodes.filter((r) => comp.hubIds.includes(r.id) || comp.pylonIds.includes(r.id));
  if (compRelays.length === 0) {
    return { overloadedPylons: [], overloadedShedEntityIds: [], pylonLoads: {}, shedConsumerRows: new Set(), absorbedSyntheticLoad: 0 };
  }

  const rootRelayId = findHighestNetGeneratorRelayId(state, colonyIndex, comp, graph, env, windOut, tick, data);
  const tree = buildSpanningTree(compRelays, rootRelayId);

  for (const c of bRes.shedCandidates) {
    if (state.entities.cols.state[c.row] === ENTITY_STATE.offlineOverload) {
      setField(state.entities, c.row, 'state', ENTITY_STATE.active, tick);
    }
  }

  const consumersByRelay = new Map<number, ShedCandidate[]>();
  for (const r of compRelays) consumersByRelay.set(r.id, []);
  for (const c of bRes.shedCandidates) {
    const rId = graph.attachedRelayByBuildingId.get(c.entityId);
    if (typeof rId === 'number' && consumersByRelay.has(rId)) {
      consumersByRelay.get(rId)!.push(c);
    }
  }

  const colExt = state.colonies[colonyIndex] as { syntheticLoadEntityId?: number; syntheticLoadPylonId?: number } | undefined;
  const hasExplicitTarget = typeof (colExt?.syntheticLoadEntityId ?? colExt?.syntheticLoadPylonId) === 'number';

  const { synthLoad, synthTargetId } = resolveSyntheticLoadTarget(
    state.colonies[colonyIndex], comp, tree, graph, consumersByRelay, rootRelayId,
  );

  const { flow, maxLoads } = computeRelayFlows(
    compRelays, tree, consumersByRelay, synthTargetId, synthLoad, hasExplicitTarget, hubMax, pylonMax, pylonDrainPerS(data),
  );

  const initialFlow = new Map(flow);
  const shedConsumerRows = new Set<number>();
  const overloadedShedEntityIds: number[] = [];
  const pylonShedMap = new Map<number, number[]>();
  for (const r of compRelays) pylonShedMap.set(r.id, []);

  for (const u of tree.reverseBfs) {
    const maxL = maxLoads.get(u) ?? pylonMax;
    if ((flow.get(u) ?? 0) > maxL + 1e-6) {
      shedSubtreeConsumers(
        u, maxL, tree, flow, consumersByRelay, shedConsumerRows,
        overloadedShedEntityIds, pylonShedMap, state, tick,
      );
    }
  }

  const overloadedPylons: OverloadPylonInfo[] = [];
  const pylonLoads: Record<number, PylonLoadInfo> = {};
  for (const r of compRelays) {
    const initF = initialFlow.get(r.id) ?? 0;
    const maxF = maxLoads.get(r.id) ?? pylonMax;
    const isOver = initF > maxF + 1e-6;
    const shedList = pylonShedMap.get(r.id) ?? [];
    pylonLoads[r.id] = { flow: initF, max: maxF, overloaded: isOver, shedEntityIds: shedList };
    if (isOver) {
      overloadedPylons.push({ pylonId: r.id, flowPerS: initF, maxLoadPerS: maxF, shedEntityIds: shedList });
    }
  }

  const absorbedSyntheticLoad = hasExplicitTarget && overloadedPylons.length > 0 && synthLoad > 0 ? synthLoad : 0;
  return { overloadedPylons, overloadedShedEntityIds, pylonLoads, shedConsumerRows, absorbedSyntheticLoad };
}
