import * as THREE from 'three';

export interface WreckPartRange {
  name: string;
  start: number;
  count: number;
  animType?: number;
  pivot?: THREE.Vector3Tuple;
}

interface PartBox {
  idx: number;
  range: WreckPartRange;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  cx: number;
  cy: number;
  cz: number;
  extent: number;
  triCount: number;
  key: string;
  isCore: boolean;
  isHover: boolean;
  isCable: boolean;
}

const AABB_EPS = 0.055;

function boxesOverlap(a: PartBox, b: PartBox, eps = AABB_EPS): boolean {
  return (
    a.minX - eps <= b.maxX && b.minX - eps <= a.maxX &&
    a.minY - eps <= b.maxY && b.minY - eps <= a.maxY &&
    a.minZ - eps <= b.maxZ && b.minZ - eps <= a.maxZ
  );
}

function classifyClusterKey(name: string, cx: number, cz: number, idx: number, isBuilding: boolean): { key: string; isCore: boolean } {
  const n = name.toLowerCase();
  const isOuterSuffix = /(turret|head|canopy|drone|arm|leg|wheel|tire|rim|blade|rotor|wing|panel|solar|barrel|cannon|muzzle|dish|radar|antenna|sensor|pod|launcher|cap|cover|light|bezel|visor|emitter|coil|relay|whip|banner)/.test(n);
  const isStructuralCore = /\b(plinth|foundation|floor|chassis|torso|hull|body|main hall|base|pedestal|barbette|furnace|reactor|depot|warehouse|capacitor|tower|pylon|spine|bunker)\b/.test(n);
  if ((isStructuralCore || (n.includes('carapace') && !isOuterSuffix)) && !isOuterSuffix) {
    return { key: 'core', isCore: true };
  }
  const sideX = cx < -0.08 ? 'L' : cx > 0.08 ? 'R' : 'C';
  const sideZ = cz < -0.08 ? 'B' : cz > 0.08 ? 'F' : 'M';
  if (/solar|wing|photovoltaic|\bpv\b/.test(n)) return { key: `solar_${sideX}`, isCore: false };
  if (/wheel|tire|tyre|rim|hub|tread|track|axle|bogie/.test(n)) return { key: `wheel_${sideX}${sideZ}`, isCore: false };
  if (/leg|hip|femur|tibia|shin|thigh|foot|coxa|knee/.test(n)) return { key: `leg_${sideX}${sideZ}`, isCore: false };
  if (/dish|radar|antenna|sensor|transceiver|mast|relay/.test(n)) return { key: `dish_${sideX}${sideZ}`, isCore: false };
  if (/arm|claw|drill|cutter|weld|boom|crane/.test(n)) return { key: `arm_${sideX}${sideZ}`, isCore: false };
  if (/cannon|barrel|turret|gun|launcher|rocket|missile|muzzle|emitter|coil/.test(n)) return { key: `weapon_${sideX}`, isCore: false };
  if (/drone|rotor|blade|nacelle|turbine/.test(n)) return { key: `rotor_${sideX}${sideZ}`, isCore: false };
  if (/silo|tank|drum|stack|boiler|pipe|conduit|exhaust|vent|radiator|heatsink/.test(n)) return { key: `mech_${sideX}${sideZ}`, isCore: false };
  if (/canopy|dome|visor|optic|head/.test(n)) return { key: 'canopy', isCore: false };
  if (isBuilding && /conveyor|bay|monitor|buttress|portico|bridge|lattice|deck|gantry/.test(n)) return { key: `sub_${sideX}${sideZ}`, isCore: false };
  return { key: `part_${idx}`, isCore: false };
}

function buildPartBoxes(pos: THREE.BufferAttribute, ranges: readonly WreckPartRange[], isBuilding: boolean): PartBox[] {
  return ranges.map((r, idx) => {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = r.start; i < r.start + r.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    const cx = (minX + maxX) * 0.5, cy = (minY + maxY) * 0.5, cz = (minZ + maxZ) * 0.5;
    const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
    const { key, isCore } = classifyClusterKey(r.name, cx, cz, idx, isBuilding);
    const isHover = r.animType === 4 || /hover|float/i.test(r.name);
    const isCable = /cable|guy|hose|tether|cord/i.test(r.name);
    return { idx, range: r, minX, minY, minZ, maxX, maxY, maxZ, cx, cy, cz, extent, triCount: Math.floor(r.count / 3), key, isCore, isHover, isCable };
  });
}

function buildAdjacency(parts: readonly PartBox[]): number[][] {
  const adj: number[][] = parts.map(() => []);
  for (let i = 0; i < parts.length; i++) {
    if (parts[i]!.isCable) continue;
    for (let j = i + 1; j < parts.length; j++) {
      if (parts[j]!.isCable) continue;
      if (boxesOverlap(parts[i]!, parts[j]!)) {
        adj[i]!.push(j);
        adj[j]!.push(i);
      }
    }
  }
  return adj;
}

function connectedComponents(nodes: readonly number[], adj: readonly number[][], allowed: ReadonlySet<number>): number[][] {
  const seen = new Set<number>();
  const comps: number[][] = [];
  for (const start of nodes) {
    if (!allowed.has(start) || seen.has(start)) continue;
    const comp: number[] = [];
    const queue = [start];
    seen.add(start);
    while (queue.length > 0) {
      const u = queue.shift()!;
      comp.push(u);
      for (const v of adj[u]!) {
        if (allowed.has(v) && !seen.has(v)) {
          seen.add(v);
          queue.push(v);
        }
      }
    }
    comps.push(comp);
  }
  return comps;
}

function pointToBoxDist(px: number, py: number, pz: number, b: PartBox): number {
  const dx = px < b.minX ? b.minX - px : px > b.maxX ? px - b.maxX : 0;
  const dy = py < b.minY ? b.minY - py : py > b.maxY ? py - b.maxY : 0;
  const dz = pz < b.minZ ? b.minZ - pz : pz > b.maxZ ? pz - b.maxZ : 0;
  return Math.hypot(dx, dy, dz);
}

function cableEndpointDist(pos: THREE.BufferAttribute, p: PartBox, b: PartBox): number {
  const s = p.range.start;
  const e = p.range.start + Math.max(0, p.range.count - 1);
  const d0 = pointToBoxDist(pos.getX(s), pos.getY(s), pos.getZ(s), b);
  const d1 = pointToBoxDist(pos.getX(e), pos.getY(e), pos.getZ(e), b);
  return Math.min(d0, d1);
}

function attachSmallParts(pos: THREE.BufferAttribute, parts: PartBox[], adj: number[][]): void {
  for (const p of parts) {
    const isUnclassified = !p.isCore && /^part_/.test(p.key);
    const sameKeyNeighbor = !p.isCable && !p.isCore && adj[p.idx]!.some((ni) => parts[ni]!.key === p.key && !parts[ni]!.isCable);
    if (sameKeyNeighbor) continue;
    const isOrphanSmall = !p.isCore && p.extent < 0.34;
    if (!p.isCable && !isUnclassified && !isOrphanSmall) continue;
    const rawPool = p.isCable
      ? parts.filter((n) => !n.isCable && cableEndpointDist(pos, p, n) <= AABB_EPS * 1.5)
      : adj[p.idx]!.map((ni) => parts[ni]!);
    const candidates = rawPool.filter((n) => n.idx !== p.idx && !n.isCable && (!/^part_/.test(n.key) || n.isCore || n.extent >= 0.34));
    const search = candidates.length > 0 ? candidates : parts.filter((n) => n.idx !== p.idx && !n.isCable && (n.isCore || n.extent >= 0.34 || !/^part_/.test(n.key)));
    let best: PartBox | null = null;
    let bestScore = Infinity;
    for (const n of search) {
      if (n.isCable) continue;
      const surfaceD = p.isCable ? cableEndpointDist(pos, p, n) : pointToBoxDist(p.cx, p.cy, p.cz, n);
      const centD = Math.hypot(n.cx - p.cx, n.cy - p.cy, n.cz - p.cz);
      const decoPenalty = /light|ring|halo|bezel|cap|collar/i.test(n.range.name) ? 0.12 : 0;
      const corePenalty = p.isCable && n.isCore ? 0.25 : 0;
      const score = surfaceD * 8 + centD * 0.1 + decoPenalty + corePenalty;
      if (score < bestScore) { bestScore = score; best = n; }
    }
    if (best) {
      p.key = best.key;
      p.isCore = best.isCore;
      if (p.isCable) {
        adj[p.idx]!.push(best.idx);
        adj[best.idx]!.push(p.idx);
      }
    }
  }
}

function selectCoreRoot(parts: readonly PartBox[], adj: readonly number[][]): Set<number> {
  const allIds = parts.map((p) => p.idx);
  const fullSet = new Set(allIds);
  const fullComps = connectedComponents(allIds, adj, fullSet);
  fullComps.sort((a, b) => b.reduce((s, i) => s + parts[i]!.triCount, 0) - a.reduce((s, i) => s + parts[i]!.triCount, 0));
  const mainOrig = new Set(fullComps[0] ?? allIds);

  const coreCandidates = new Set(parts.filter((p) => p.isCore && mainOrig.has(p.idx) && !p.isHover).map((p) => p.idx));
  if (coreCandidates.size === 0 && mainOrig.size > 0) {
    const sorted = [...mainOrig].sort((a, b) => (parts[a]!.minY - parts[b]!.minY) || (parts[b]!.triCount - parts[a]!.triCount));
    coreCandidates.add(sorted[0]!);
  }
  const coreComps = connectedComponents([...coreCandidates], adj, coreCandidates);
  coreComps.sort((a, b) => {
    const aMinY = Math.min(...a.map((i) => parts[i]!.minY));
    const bMinY = Math.min(...b.map((i) => parts[i]!.minY));
    const aTris = a.reduce((s, i) => s + parts[i]!.triCount, 0);
    const bTris = b.reduce((s, i) => s + parts[i]!.triCount, 0);
    return (bTris - aTris) + (aMinY - bMinY) * 20;
  });
  return new Set(coreComps[0] ?? []);
}

function pickCandidateShards(parts: readonly PartBox[], adj: readonly number[][], coreRoot: Set<number>, rand: () => number): number[][] {
  const allIds = parts.map((p) => p.idx);
  const mainComps = connectedComponents(allIds, adj, new Set(allIds));
  mainComps.sort((a, b) => b.reduce((s, i) => s + parts[i]!.triCount, 0) - a.reduce((s, i) => s + parts[i]!.triCount, 0));
  const mainOrig = new Set(mainComps[0] ?? allIds);
  const forcedIds = parts.filter((p) => (!mainOrig.has(p.idx) || p.isHover) && !coreRoot.has(p.idx) && p.minY > 0.14).map((p) => p.idx);

  const byKey = new Map<string, number[]>();
  for (const p of parts) {
    if (coreRoot.has(p.idx) || forcedIds.includes(p.idx) || p.key === 'core') continue;
    let list = byKey.get(p.key);
    if (!list) { list = []; byKey.set(p.key, list); }
    list.push(p.idx);
  }
  const candidateClusters: number[][] = [];
  for (const ids of byKey.values()) {
    for (const comp of connectedComponents(ids, adj, new Set(ids))) candidateClusters.push(comp);
  }
  candidateClusters.sort(() => rand() - 0.5);

  const totalTris = Math.max(1, parts.reduce((s, p) => s + p.triCount, 0));
  const targetCount = Math.min(6, Math.max(1, Math.round(candidateClusters.length * 0.45)));
  const detached = new Set<number>(forcedIds);
  const shardList: number[][] = forcedIds.length > 0 ? connectedComponents(forcedIds, adj, new Set(forcedIds)) : [];
  const rootSeeds = [...coreRoot];

  for (const cluster of candidateClusters) {
    if (shardList.length >= targetCount) break;
    const trialDetached = new Set(detached);
    for (const id of cluster) trialDetached.add(id);
    if (rootSeeds.length === 0) break;

    const alive = new Set(allIds.filter((id) => !trialDetached.has(id)));
    const reachable = new Set<number>();
    for (const comp of connectedComponents(rootSeeds, adj, alive)) for (const id of comp) reachable.add(id);
    const lost = [...alive].filter((id) => !reachable.has(id));
    const coreTris = [...reachable].reduce((s, id) => s + parts[id]!.triCount, 0);
    if (coreTris < totalTris * 0.36) continue;

    for (const id of cluster) detached.add(id);
    for (const id of lost) detached.add(id);
    const combined = [...cluster, ...lost];
    for (const comp of connectedComponents(combined, adj, new Set(combined))) shardList.push(comp);
  }
  return shardList;
}

function buildIndicesForParts(parts: readonly PartBox[], ids: readonly number[]): number[] {
  const out: number[] = [];
  for (const id of ids) {
    const r = parts[id]!.range;
    for (let i = r.start; i < r.start + r.count; i++) out.push(i);
  }
  return out;
}

function fallbackPrimitiveShatter(pos: THREE.BufferAttribute, coreIndices: number[]): number[][] {
  const triCount = Math.floor(coreIndices.length / 3);
  const tris: { a: number; b: number; c: number; cy: number; cx: number }[] = [];
  for (let t = 0; t < triCount; t++) {
    const a = coreIndices[t * 3]!, b = coreIndices[t * 3 + 1]!, c = coreIndices[t * 3 + 2]!;
    tris.push({ a, b, c, cy: (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3, cx: (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3 });
  }
  tris.sort((u, v) => v.cy - u.cy);
  const takeTris = Math.max(2, Math.floor(triCount * 0.3));
  const s0: number[] = [], s1: number[] = [], rest: number[] = [];
  for (let i = 0; i < tris.length; i++) {
    const tr = tris[i]!;
    if (i < takeTris) (tr.cx < 0 ? s0 : s1).push(tr.a, tr.b, tr.c);
    else rest.push(tr.a, tr.b, tr.c);
  }
  coreIndices.length = 0;
  for (const vi of rest) coreIndices.push(vi);
  const shards: number[][] = [];
  if (s0.length >= 3) shards.push(s0);
  if (s1.length >= 3) shards.push(s1);
  return shards;
}

export function partitionConnectedWreckShatter(
  pos: THREE.BufferAttribute,
  ranges: readonly WreckPartRange[],
  isBuilding: boolean,
  rand: () => number,
): { coreIndices: number[]; shards: number[][] } {
  const parts = buildPartBoxes(pos, ranges, isBuilding);
  if (parts.length <= 1) {
    const coreIndices = buildIndicesForParts(parts, parts.map((p) => p.idx));
    const shards = coreIndices.length >= 18 ? fallbackPrimitiveShatter(pos, coreIndices) : [];
    return { coreIndices, shards };
  }
  const adj = buildAdjacency(parts);
  attachSmallParts(pos, parts, adj);
  const coreRoot = selectCoreRoot(parts, adj);
  const rawShards = pickCandidateShards(parts, adj, coreRoot, rand);
  const detachedSet = new Set<number>();
  for (const s of rawShards) for (const id of s) detachedSet.add(id);

  const rootSeeds = [...coreRoot];
  const remaining = new Set(parts.map((p) => p.idx).filter((id) => !detachedSet.has(id)));
  const reachable = new Set<number>();
  for (const comp of connectedComponents(rootSeeds, adj, remaining)) for (const id of comp) reachable.add(id);
  const stranded = [...remaining].filter((id) => !reachable.has(id));
  const coreIds = [...reachable];

  const shards: number[][] = [];
  for (const s of rawShards) {
    const idxList = buildIndicesForParts(parts, s);
    if (idxList.length >= 3) shards.push(idxList);
  }
  if (stranded.length > 0) {
    for (const comp of connectedComponents(stranded, adj, new Set(stranded))) {
      const idxList = buildIndicesForParts(parts, comp);
      if (idxList.length >= 3) shards.push(idxList);
    }
  }
  return { coreIndices: buildIndicesForParts(parts, coreIds), shards };
}
