import * as THREE from 'three';
import { ArchetypeCatalog } from '@terra/render/kitbash';
import { reconFactionPreview } from '@terra/render/kitbash/archetypes/units/reconFaction';
import { extractArchetype, groundContact } from '@terra/render/kitbash/validate';

export const ANIM_NAME: Record<number, string> = { 0: 'static', 1: 'spin', 2: 'bob', 3: 'recoil' };

function computeStats(id: string) {
  const g = ArchetypeCatalog.get(id).create();
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const tris = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
  const anim = new Set<number>();
  const a = g.getAttribute('aPartAnim');
  if (a) for (let i = 0; i < a.count; i++) anim.add(a.getX(i));
  const cat = ArchetypeCatalog.get(id).category;
  // Ships, props, and the flying drifter: no ground rule (same split as `validateArchetype`).
  const contact = cat === 'ship' || cat === 'prop' || id === 'fauna.drifter' ? null : groundContact(extractArchetype(id));
  const out = { tris: Math.round(tris), verts: g.attributes.position.count, size: bb.getSize(new THREE.Vector3()), minY: bb.min.y, contact, anim: [...anim].sort(), attrs: Object.keys(g.attributes) };
  g.dispose();
  return out;
}

export type ArchetypeStats = ReturnType<typeof computeStats>;
const cache = new Map<string, ArchetypeStats>();
export function archetypeStats(id: string): ArchetypeStats {
  const key = `${id}|${reconFactionPreview() ?? ''}`;
  if (!cache.has(key)) cache.set(key, computeStats(id));
  return cache.get(key)!;
}
