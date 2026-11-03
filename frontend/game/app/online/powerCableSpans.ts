import type * as THREE from 'three';
import {
  buildingCableAnchor,
  pylonCableAnchor,
  PYLON_CONDUCTORS,
  type CableAnchor,
  type CablePowerState,
  type CableSpan,
} from '@terra/render/lighting/gridCables';
import { ENTITY_KIND } from '@terra/sim';
import { readColonyPower } from '../../features/shared/power';
import { archetypeForKind } from './entityKinds';

/**
 * Which cables the grid shows, derived from SYNCED power data only (no power rule is evaluated here, D-31): the sim's
 * `col.power.components` say which Hubs, pylons and buildings form one grid and whether it is powered, shed
 * (brownout) or overloaded (`pylonLoads`). Inside a component the relays (Hub + pylons) are wired as a minimum
 * spanning tree rooted at the Hub, and each attached building to its nearest relay, so energy visibly flows from the
 * Hub outward. This is a picture of the grid, not the sim's adjacency (a pylon may reach more relays than it is
 * wired to here).
 */

/** The parts of an entity record the cable layout reads. */
export interface CableNodeSource {
  id: number;
  kind: number;
  owner: number;
  mesh: THREE.Object3D;
}

interface ComponentView {
  componentId?: number;
  entityIds?: number[];
  powered?: boolean;
  shedEntityIds?: number[];
  deficitPerS?: number;
}

interface Node {
  id: number;
  isPylon: boolean;
  relay: boolean;
  archetypeId: string;
  mesh: THREE.Object3D;
}

const RELAY_SAG = { base: 0.15, perM: 0.06 };
const DROP_SAG = { base: 0.1, perM: 0.05 };
const RELAY_RADIUS = 0.03;
const DROP_RADIUS = 0.024;

function seedOf(a: number, b: number, k: number): number {
  const x = Math.sin(a * 127.1 + b * 311.7 + k * 74.7) * 43758.5453;
  return x - Math.floor(x);
}

function geometryOf(mesh: THREE.Object3D): THREE.BufferGeometry | null {
  return (mesh as THREE.Mesh).isMesh ? (mesh as THREE.Mesh).geometry ?? null : null;
}

/** Model-space anchor of `node` facing world point `(tx, tz)`, returned in world space. */
function anchorToward(node: Node, tx: number, tz: number, conductor: number): CableAnchor {
  const { position: p, rotation, scale } = node.mesh;
  const yaw = rotation.y;
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  const wx = tx - p.x, wz = tz - p.z;
  // World → model: inverse of x' = x cos + z sin, z' = -x sin + z cos.
  const lx = wx * cos - wz * sin;
  const lz = wx * sin + wz * cos;
  const geo = geometryOf(node.mesh);
  const strip = Number((geo?.userData as { stripOffsetY?: number } | undefined)?.stripOffsetY ?? 0);
  let local: CableAnchor;
  if (node.isPylon) {
    local = pylonCableAnchor(conductor, lx, strip);
  } else {
    if (geo && !geo.boundingBox) geo.computeBoundingBox();
    local = buildingCableAnchor(node.archetypeId, geo?.boundingBox ?? null, lx, lz, strip);
    local[1] += conductor * 0.32; // a second conductor enters the wall above the first
  }
  const s = scale.x || 1;
  const [x, y, z] = local;
  return [p.x + (x * cos + z * sin) * s, p.y + y * s, p.z + (-x * sin + z * cos) * s];
}

function spanBetween(up: Node, down: Node, conductor: number, state: CablePowerState, drop: boolean): CableSpan {
  const a = anchorToward(up, down.mesh.position.x, down.mesh.position.z, conductor);
  const b = anchorToward(down, up.mesh.position.x, up.mesh.position.z, conductor);
  const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
  const sag = drop ? DROP_SAG.base + DROP_SAG.perM * len : RELAY_SAG.base + RELAY_SAG.perM * len;
  return { a, b, sag, radius: drop ? DROP_RADIUS : RELAY_RADIUS, state, seed: seedOf(up.id, down.id, conductor) };
}

const dist2 = (a: Node, b: Node) =>
  (a.mesh.position.x - b.mesh.position.x) ** 2 + (a.mesh.position.z - b.mesh.position.z) ** 2;

/** Prim's tree over the relays, rooted at the lowest-id Hub (else the lowest id): `[parent, child]` pairs. */
export function relayTree<T extends { id: number }>(relays: readonly T[], isRoot: (n: T) => boolean, d2: (a: T, b: T) => number): Array<[T, T]> {
  if (relays.length < 2) return [];
  const sorted = [...relays].sort((a, b) => a.id - b.id);
  const root = sorted.find(isRoot) ?? sorted[0];
  const rest = sorted.filter((n) => n !== root);
  // O(n²) Prim: each remaining node keeps its nearest tree node so far.
  const parent = rest.map(() => root);
  const dist = rest.map((n) => d2(root, n));
  const edges: Array<[T, T]> = [];
  while (rest.length > 0) {
    let best = 0;
    for (let i = 1; i < rest.length; i++) if (dist[i] < dist[best]) best = i;
    const child = rest[best];
    edges.push([parent[best], child]);
    rest.splice(best, 1); parent.splice(best, 1); dist.splice(best, 1);
    for (let i = 0; i < rest.length; i++) {
      const d = d2(child, rest[i]);
      if (d < dist[i]) { dist[i] = d; parent[i] = child; }
    }
  }
  return edges;
}

function componentState(comp: ComponentView): CablePowerState {
  if (!comp.powered) return 'off';
  if ((comp.shedEntityIds?.length ?? 0) > 0 || (comp.deficitPerS ?? 0) > 0) return 'brownout';
  return 'online';
}

function spansForComponent(comp: ComponentView, nodes: Map<number, Node>, overloaded: (id: number) => boolean): CableSpan[] {
  const members = (comp.entityIds ?? []).map((id) => nodes.get(id)).filter((n): n is Node => n !== undefined);
  const relays = members.filter((n) => n.relay);
  const buildings = members.filter((n) => !n.relay);
  const base = componentState(comp);
  const shed = new Set(comp.shedEntityIds ?? []);
  const out: CableSpan[] = [];
  for (const [up, down] of relayTree(relays, (n) => !n.isPylon, dist2)) {
    const state = base !== 'off' && (overloaded(up.id) || overloaded(down.id)) ? 'overload' : base;
    for (let k = 0; k < PYLON_CONDUCTORS; k++) out.push(spanBetween(up, down, k, state, false));
  }
  if (relays.length === 0) return out;
  for (const b of buildings) {
    let near = relays[0];
    for (const r of relays) if (dist2(r, b) < dist2(near, b)) near = r;
    const state = shed.has(b.id) ? 'off' : base !== 'off' && overloaded(near.id) ? 'overload' : base;
    out.push(spanBetween(near, b, 0, state, true));
  }
  return out;
}

/** The cable spans of colony `colonyIndex`'s grid in `view` (empty without a component summary). */
export function derivePowerCableSpans(records: Iterable<CableNodeSource>, view: unknown, colonyIndex: number): CableSpan[] {
  const power = readColonyPower(view, colonyIndex);
  const comps = (power?.components ?? []) as ComponentView[];
  if (!Array.isArray(comps) || comps.length === 0) return [];
  const loads = (power?.pylonLoads ?? {}) as Record<number, { overloaded?: boolean } | undefined>;
  const overloaded = (id: number) => Boolean(loads[id]?.overloaded);
  const nodes = new Map<number, Node>();
  for (const r of records) {
    if (r.owner !== colonyIndex || !r.mesh.visible) continue;
    const isPylon = r.kind === ENTITY_KIND.pylon;
    const relay = isPylon || r.kind === ENTITY_KIND.commandHub;
    nodes.set(r.id, { id: r.id, isPylon, relay, archetypeId: archetypeForKind(r.kind), mesh: r.mesh });
  }
  const sorted = [...comps].sort((a, b) => (a.componentId ?? 0) - (b.componentId ?? 0));
  return sorted.flatMap((c) => spansForComponent(c, nodes, overloaded));
}
