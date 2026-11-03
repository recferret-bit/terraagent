import type { CompiledDataLike } from '../../kernel/config';
import type { PlanetState } from '../../kernel/state';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { hexDistance } from '../../grid/hex';
import { resolvePowerRow } from './index';

export interface BuildingFootprintTile {
  q: number;
  r: number;
}

export interface RelayNode {
  row: number;
  id: number;
  kind: number;
  q: number;
  r: number;
  span: number;
  footprintTiles: BuildingFootprintTile[];
  componentId: number;
}

export interface PowerGraphComponent {
  componentId: number;
  hasHub: boolean;
  hubIds: number[];
  pylonIds: number[];
  attachedBuildingRows: number[];
  attachedBuildingIds: number[];
}

export interface PowerGraph {
  relayNodes: RelayNode[];
  components: PowerGraphComponent[];
  componentByRelayId: Map<number, number>;
  componentByBuildingId: Map<number, number>;
  attachedRelayByBuildingId: Map<number, number>;
  unattachedBuildingRows: number[];
  unattachedBuildingIds: number[];
  hasHub: boolean;
  hubAnchors: BuildingFootprintTile[];
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

function collectRelayNodes(
  state: PlanetState,
  colonyIndex: number,
  data?: CompiledDataLike,
): { relayNodes: RelayNode[]; hubAnchors: BuildingFootprintTile[]; hasHub: boolean } {
  const hubRow = resolvePowerRow(data, 'hub', 't1');
  const pylonRow = resolvePowerRow(data, 'grid', 'pylon');
  const hubSpan = Number(hubRow.pylonSpan ?? 6);
  const pylonSpan = Number(pylonRow.span ?? 6);

  const e = state.entities, cols = e.cols;
  const relayNodes: RelayNode[] = [];
  const hubAnchors: BuildingFootprintTile[] = [];
  let hasHub = false;

  for (let row = 0; row < e.count; row++) {
    if (cols.owner[row] !== colonyIndex || cols.hp[row] <= 0) continue;
    if (cols.state[row] === ENTITY_STATE.constructing) continue;
    const kind = cols.kind[row];
    if (kind === ENTITY_KIND.commandHub) {
      hasHub = true;
      const w = cols.footprintW?.[row] || Number(hubRow.footprintW ?? 3);
      const d = cols.footprintD?.[row] || Number(hubRow.footprintD ?? 3);
      const tiles = getEntityFootprintTiles(cols.q[row], cols.r[row], w, d, cols.rot[row]);
      hubAnchors.push({ q: cols.q[row], r: cols.r[row] });
      relayNodes.push({
        row, id: cols.id[row], kind, q: cols.q[row], r: cols.r[row],
        span: hubSpan, footprintTiles: tiles, componentId: -1,
      });
    } else if (kind === ENTITY_KIND.pylon) {
      const w = cols.footprintW?.[row] || 1;
      const d = cols.footprintD?.[row] || 1;
      const tiles = getEntityFootprintTiles(cols.q[row], cols.r[row], w, d, cols.rot[row]);
      relayNodes.push({
        row, id: cols.id[row], kind, q: cols.q[row], r: cols.r[row],
        span: pylonSpan, footprintTiles: tiles, componentId: -1,
      });
    }
  }
  return { relayNodes, hubAnchors, hasHub };
}

function partitionRelayComponents(relayNodes: RelayNode[]): {
  components: PowerGraphComponent[];
  componentByRelayId: Map<number, number>;
} {
  const componentByRelayId = new Map<number, number>();
  if (relayNodes.length === 0) return { components: [], componentByRelayId };

  const adj: number[][] = Array.from({ length: relayNodes.length }, () => []);
  for (let i = 0; i < relayNodes.length; i++) {
    for (let j = i + 1; j < relayNodes.length; j++) {
      const a = relayNodes[i], b = relayNodes[j];
      const maxSpan = Math.max(a.span, b.span);
      if (minFootprintDistance(a.footprintTiles, b.footprintTiles) <= maxSpan) {
        adj[i].push(j);
        adj[j].push(i);
      }
    }
  }

  const visited = new Uint8Array(relayNodes.length);
  const rawComponents: number[][] = [];
  for (let i = 0; i < relayNodes.length; i++) {
    if (visited[i]) continue;
    const comp: number[] = [];
    const queue = [i];
    visited[i] = 1;
    while (queue.length > 0) {
      const curr = queue.shift()!;
      comp.push(curr);
      for (const n of adj[curr]) {
        if (!visited[n]) {
          visited[n] = 1;
          queue.push(n);
        }
      }
    }
    rawComponents.push(comp);
  }

  rawComponents.sort((a, b) => {
    const aHubs = a.map((idx) => relayNodes[idx]).filter((n) => n.kind === ENTITY_KIND.commandHub);
    const bHubs = b.map((idx) => relayNodes[idx]).filter((n) => n.kind === ENTITY_KIND.commandHub);
    if (aHubs.length > 0 && bHubs.length > 0) {
      return Math.min(...aHubs.map((h) => h.id)) - Math.min(...bHubs.map((h) => h.id));
    }
    if (aHubs.length > 0) return -1;
    if (bHubs.length > 0) return 1;
    return Math.min(...a.map((idx) => relayNodes[idx].id)) - Math.min(...b.map((idx) => relayNodes[idx].id));
  });

  const components: PowerGraphComponent[] = [];
  for (let cId = 0; cId < rawComponents.length; cId++) {
    const nodeIndices = rawComponents[cId];
    const hubIds: number[] = [];
    const pylonIds: number[] = [];
    for (const idx of nodeIndices) {
      relayNodes[idx].componentId = cId;
      componentByRelayId.set(relayNodes[idx].id, cId);
      if (relayNodes[idx].kind === ENTITY_KIND.commandHub) hubIds.push(relayNodes[idx].id);
      else pylonIds.push(relayNodes[idx].id);
    }
    components.push({
      componentId: cId,
      hasHub: hubIds.length > 0,
      hubIds,
      pylonIds,
      attachedBuildingRows: [],
      attachedBuildingIds: [],
    });
  }
  return { components, componentByRelayId };
}

const POWERED_BUILDING_KINDS: ReadonlySet<number> = new Set<number>([
  ENTITY_KIND.solar,
  ENTITY_KIND.wind,
  ENTITY_KIND.thermal,
  ENTITY_KIND.capacitor,
  ENTITY_KIND.metalsExtractor,
  ENTITY_KIND.mineralsQuarry,
  ENTITY_KIND.waterExtractor,
  ENTITY_KIND.petroleumWell,
  ENTITY_KIND.supplyDepot,
]);

function attachBuildingsToRelays(
  state: PlanetState,
  colonyIndex: number,
  relayNodes: RelayNode[],
  components: PowerGraphComponent[],
  attachRadius: number,
  hasHub: boolean,
): {
  componentByBuildingId: Map<number, number>;
  attachedRelayByBuildingId: Map<number, number>;
  unattachedBuildingRows: number[];
  unattachedBuildingIds: number[];
} {
  const e = state.entities, cols = e.cols;
  const componentByBuildingId = new Map<number, number>();
  const attachedRelayByBuildingId = new Map<number, number>();
  const unattachedBuildingRows: number[] = [];
  const unattachedBuildingIds: number[] = [];

  if (relayNodes.length === 0 && !hasHub) {
    const comp: PowerGraphComponent = {
      componentId: 0,
      hasHub: false,
      hubIds: [],
      pylonIds: [],
      attachedBuildingRows: [],
      attachedBuildingIds: [],
    };
    components.push(comp);
    for (let row = 0; row < e.count; row++) {
      if (cols.owner[row] !== colonyIndex || cols.hp[row] <= 0) continue;
      if (!POWERED_BUILDING_KINDS.has(cols.kind[row])) continue;
      const bId = cols.id[row];
      componentByBuildingId.set(bId, 0);
      comp.attachedBuildingRows.push(row);
      comp.attachedBuildingIds.push(bId);
    }
    return { componentByBuildingId, attachedRelayByBuildingId, unattachedBuildingRows, unattachedBuildingIds };
  }

  for (let row = 0; row < e.count; row++) {
    if (cols.owner[row] !== colonyIndex || cols.hp[row] <= 0) continue;
    if (!POWERED_BUILDING_KINDS.has(cols.kind[row])) continue;
    const bId = cols.id[row];

    const w = cols.footprintW?.[row] || 2;
    const d = cols.footprintD?.[row] || 2;
    const bTiles = getEntityFootprintTiles(cols.q[row], cols.r[row], w, d, cols.rot[row]);

    let bestRelay: RelayNode | null = null;
    let bestDist = Infinity;

    for (const rNode of relayNodes) {
      const distToFootprint = minFootprintDistance(bTiles, rNode.footprintTiles);
      let qualifies = distToFootprint <= attachRadius;
      if (!qualifies && rNode.kind === ENTITY_KIND.commandHub) {
        const distToAnchor = minFootprintDistance(bTiles, [{ q: rNode.q, r: rNode.r }]);
        if (distToAnchor <= 6) qualifies = true;
      }
      if (qualifies) {
        if (distToFootprint < bestDist || (distToFootprint === bestDist && (!bestRelay || rNode.id < bestRelay.id))) {
          bestDist = distToFootprint;
          bestRelay = rNode;
        }
      }
    }

    if (bestRelay !== null) {
      const cId = bestRelay.componentId;
      componentByBuildingId.set(bId, cId);
      attachedRelayByBuildingId.set(bId, bestRelay.id);
      components[cId].attachedBuildingRows.push(row);
      components[cId].attachedBuildingIds.push(bId);
    } else {
      componentByBuildingId.set(bId, -1);
      unattachedBuildingRows.push(row);
      unattachedBuildingIds.push(bId);
    }
  }
  return { componentByBuildingId, attachedRelayByBuildingId, unattachedBuildingRows, unattachedBuildingIds };
}

/** Constructs the complete Power Graph v2 for `colonyIndex`. */
export function buildPowerGraph(
  state: PlanetState,
  colonyIndex: number,
  data?: CompiledDataLike,
): PowerGraph {
  const { relayNodes, hubAnchors, hasHub } = collectRelayNodes(state, colonyIndex, data);
  const { components, componentByRelayId } = partitionRelayComponents(relayNodes);
  const dayCycleRow = resolvePowerRow(data, 'economyT1Basic', 'dayCycle');
  const attachRadius = Number(dayCycleRow.pylonAttachRadius ?? 3);

  const { componentByBuildingId, attachedRelayByBuildingId, unattachedBuildingRows, unattachedBuildingIds } = attachBuildingsToRelays(
    state, colonyIndex, relayNodes, components, attachRadius, hasHub,
  );

  return {
    relayNodes,
    components,
    componentByRelayId,
    componentByBuildingId,
    attachedRelayByBuildingId,
    unattachedBuildingRows,
    unattachedBuildingIds,
    hasHub,
    hubAnchors,
  };
}

/** Backward-compatible helper checking whether a row is attached to any relay node in `graph`. */
export function isRowAttachedToPylons(
  state: PlanetState,
  row: number,
  defaultW: number,
  defaultD: number,
  graph: PowerGraph,
): boolean {
  const bId = state.entities.cols.id[row];
  const cId = graph.componentByBuildingId.get(bId);
  if (cId !== undefined) return cId >= 0;
  if (graph.relayNodes.length === 0) return !graph.hasHub;
  const cols = state.entities.cols;
  const w = cols.footprintW?.[row] || defaultW;
  const d = cols.footprintD?.[row] || defaultD;
  const bTiles = getEntityFootprintTiles(cols.q[row], cols.r[row], w, d, cols.rot[row]);
  for (const rNode of graph.relayNodes) {
    if (minFootprintDistance(bTiles, rNode.footprintTiles) <= 3) return true;
    if (rNode.kind === ENTITY_KIND.commandHub && minFootprintDistance(bTiles, [{ q: rNode.q, r: rNode.r }]) <= 6) return true;
  }
  return false;
}
