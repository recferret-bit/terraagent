import { clearCableRoofs } from './cableClearance';
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
import { archetypeForKind, isConstructibleBuilding } from './entityKinds';

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
  generator: boolean;
  offline: boolean;
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
    // Conductors share the physical terminal; never offset an endpoint into empty air.
  }
  const s = scale.x || 1;
  const [x, y, z] = local;
  return [p.x + (x * cos + z * sin) * s, p.y + y * s, p.z + (-x * sin + z * cos) * s];
}

function spanBetween(up: Node, down: Node, conductor: number, state: CablePowerState, drop: boolean, nodes: readonly Node[]): CableSpan {
  const a = anchorToward(up, down.mesh.position.x, down.mesh.position.z, conductor);
  const b = anchorToward(down, up.mesh.position.x, up.mesh.position.z, conductor);
  const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
  const sag = drop ? DROP_SAG.base + DROP_SAG.perM * len : RELAY_SAG.base + RELAY_SAG.perM * len;
  return clearCableRoofs({ a, b, sag: -Math.min(1.2, sag), radius: drop ? DROP_RADIUS : RELAY_RADIUS, state, seed: seedOf(up.id, down.id, conductor) }, nodes.filter((n) => n !== up && n !== down).map((n) => n.mesh));
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
    for (let k = 0; k < PYLON_CONDUCTORS; k++) {
      const reverse = k % 2 === 1;
      const color = reverse && state === 'online' ? 'demand' : state;
      out.push(spanBetween(reverse ? down : up, reverse ? up : down, k, color, false, [...nodes.values()]));
    }
  }
  if (relays.length === 0) return out;
  for (const b of buildings) {
    let near = relays[0];
    for (const r of relays) if (dist2(r, b) < dist2(near, b)) near = r;
    const state = b.offline || shed.has(b.id) ? 'off' : base !== 'off' && overloaded(near.id) ? 'overload' : !b.generator && base === 'online' ? 'demand' : base;
    out.push(b.generator ? spanBetween(b, near, 0, state, true, [...nodes.values()]) : spanBetween(near, b, 0, state, true, [...nodes.values()]));
  }
  for (const node of members.filter((n) => n.archetypeId === 'building.capacitor')) {
    const points = [[-0.45, 3, -0.35], [0.45, 3.35, -0.35], [0, 3.7, 0.45]];
    const strip = Number(geometryOf(node.mesh)?.userData.stripOffsetY ?? 0);
    const anchors = points.map(([x, y, z]) => {
      const c = Math.cos(node.mesh.rotation.y), s = Math.sin(node.mesh.rotation.y), scale = node.mesh.scale.x;
      return [node.mesh.position.x + (x * c + z * s) * scale, node.mesh.position.y + (y - strip) * scale, node.mesh.position.z + (-x * s + z * c) * scale] as CableAnchor;
    });
    anchors.forEach((a, i) => out.push({ a, b: anchors[(i + 1) % 3], sag: -0.12, radius: 0.009, state: shed.has(node.id) ? 'off' : base, seed: i / 3 }));
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
  const entityPower = (power?.entityPower ?? {}) as Record<number, { state?: string }>;
  const night = power?.phase === 'night' || power?.daylight === 0;
  const nodes = new Map<number, Node>();
  for (const r of records) {
    if (r.owner !== colonyIndex || !r.mesh.visible || !isConstructibleBuilding(r.kind)) continue;
    const isPylon = r.kind === ENTITY_KIND.pylon;
    const relay = isPylon || r.kind === ENTITY_KIND.commandHub;
    nodes.set(r.id, { id: r.id, isPylon, relay, offline: entityPower[r.id]?.state === 'offline' || (r.kind === ENTITY_KIND.solar && night), generator: new Set<number>([ENTITY_KIND.solar, ENTITY_KIND.wind, ENTITY_KIND.thermal]).has(r.kind), archetypeId: archetypeForKind(r.kind), mesh: r.mesh });
  }
  const sorted = [...comps].sort((a, b) => (a.componentId ?? 0) - (b.componentId ?? 0));
  return sorted.flatMap((c) => spansForComponent(c, nodes, overloaded));
}
