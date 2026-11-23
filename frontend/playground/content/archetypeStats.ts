import * as THREE from 'three';
import { getVertebrateConfig, isVertebrateGeometry } from '@terra/render/animation/vertebrates/rig';
import { ArchetypeCatalog } from '@terra/render/kitbash';
import { reconFactionPreview } from '@terra/render/kitbash/archetypes/units/reconFaction';
import { extractArchetype, groundContact } from '@terra/render/kitbash/validate';

export const ANIM_NAME: Record<number, string> = {
  0: 'static', 1: 'spin', 2: 'bob', 3: 'recoil',
  4: 'bipedLeg', 5: 'bipedArm', 6: 'spiderLeg', 7: 'wheel',
  8: 'bipedBody', 9: 'spiderBody', 14: 'shin', 16: 'tibia', 24: 'foot',
  49: 'jaw', 59: 'antenna', 60: 'sacPulse', 69: 'sac',
};

function describeVertebrateAnim(g: THREE.BufferGeometry): string[] {
  const isBird = getVertebrateConfig(g).isBird > 0.5;
  const roles = new Set<number>();
  const vj = g.getAttribute('aVertJoint');
  if (vj) for (let i = 0; i < vj.count; i++) roles.add(Math.round(vj.getW(i)));
  const names: string[] = [];
  if (isBird) {
    if (roles.has(7) || roles.has(8)) names.push('wing flap/fold');
    if (roles.has(9)) names.push('tail fan');
    if (roles.has(10)) names.push('neck/head');
  } else {
    if (roles.has(4) || roles.has(5) || roles.has(6)) names.push('quadruped IK');
    if (roles.has(2)) names.push('neck/graze');
    if (roles.has(3)) names.push('tail');
  }
  return names.length ? names : ['vertebrate rig'];
}

function computeStats(id: string) {
  const g = ArchetypeCatalog.get(id).create();
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const tris = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
  const animSet = new Set<number>();
  const a = g.getAttribute('aPartAnim');
  if (a) for (let i = 0; i < a.count; i++) animSet.add(a.getX(i));
  const anim: Array<number | string> = isVertebrateGeometry(g)
    ? describeVertebrateAnim(g)
    : [...animSet].sort((x, y) => x - y);
  const cat = ArchetypeCatalog.get(id).category;
  // Ships, props, and flying birds: no ground rule (same split as `validateArchetype`).
  const contact = cat === 'ship' || cat === 'prop' || id.startsWith('fauna.bird.') ? null : groundContact(extractArchetype(id));
  const out = { tris: Math.round(tris), verts: g.attributes.position.count, size: bb.getSize(new THREE.Vector3()), minY: bb.min.y, contact, anim, attrs: Object.keys(g.attributes) };
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
