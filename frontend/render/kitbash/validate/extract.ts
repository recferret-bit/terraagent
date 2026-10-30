// Pulls the sub-parts of a registered archetype out of the merged geometry the game renders.
import * as THREE from 'three';
import { KitbashBuilder } from '../KitbashRegistry';
import { ArchetypeCatalog } from '../catalog';
import type { ModelInput, PartDef } from './ModelValidator';

/**
 * Build the archetype exactly as the game does, capturing the KitbashBuilder's part list. Because the capture is the
 * builder's own merged geometry, scale and the minY snap done by the archetype are already applied to every vertex.
 * Archetypes that do not use KitbashBuilder fall back to connected components of the merged mesh.
 */
export function extractArchetype(id: string): ModelInput {
  const entry = ArchetypeCatalog.get(id);
  const { result: geo, built } = KitbashBuilder.capture(() => entry.create());
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.attributes.position as THREE.BufferAttribute;
  const anim = g.attributes.aPartAnim as THREE.BufferAttribute | undefined;
  const model = built.slice().reverse().find((m) => m.geometry.attributes.position.count === pos.count && m.parts.reduce((s, p) => s + p.vertexCount, 0) === pos.count);

  const slice = (start: number, count: number) => {
    const t = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) { t[i * 3] = pos.getX(start + i); t[i * 3 + 1] = pos.getY(start + i); t[i * 3 + 2] = pos.getZ(start + i); }
    return t;
  };
  const animOf = (v: number): { animType: number; pivot: [number, number, number] } =>
    anim ? { animType: Math.round(anim.getX(v)), pivot: [anim.getY(v), anim.getZ(v), anim.getW(v)] } : { animType: 0, pivot: [0, 0, 0] };

  if (model) {
    let off = 0; const parts: PartDef[] = [];
    for (const m of model.parts) {
      const a = animOf(off);
      parts.push({ index: m.index, name: m.name, zone: m.zone, kind: m.kind, animType: a.animType, pivot: a.pivot, emissive: m.emissive, color: m.color, roughness: m.roughness, metalness: m.metalness, tris: slice(off, m.vertexCount) });
      off += m.vertexCount;
    }
    return { id, label: entry.label, source: 'builder', parts };
  }

  // fallback: weld coincident vertices, then each connected triangle island is a "part"
  const n = pos.count / 3, parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const owner = new Map<string, number>();
  for (let t = 0; t < n; t++) for (let k = 0; k < 3; k++) {
    const v = t * 3 + k, key = `${Math.round(pos.getX(v) * 1e4)},${Math.round(pos.getY(v) * 1e4)},${Math.round(pos.getZ(v) * 1e4)}`;
    const o = owner.get(key); if (o === undefined) owner.set(key, t); else parent[find(t)] = find(o);
  }
  const groups = new Map<number, number[]>();
  for (let t = 0; t < n; t++) { const r = find(t); (groups.get(r) ?? groups.set(r, []).get(r)!).push(t); }
  const parts: PartDef[] = []; let idx = 0;
  for (const tris of groups.values()) {
    const t = new Float32Array(tris.length * 9);
    tris.forEach((ti, i) => { for (let k = 0; k < 9; k++) t[i * 9 + k] = [pos.getX, pos.getY, pos.getZ][k % 3].call(pos, ti * 3 + Math.floor(k / 3)); });
    const a = animOf(tris[0] * 3);
    parts.push({ index: idx, name: `component#${idx}`, zone: 'unknown', kind: 'component', animType: a.animType, pivot: a.pivot, emissive: 0, tris: t });
    idx++;
  }
  return { id, label: entry.label, source: 'components', parts };
}
