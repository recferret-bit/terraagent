import * as THREE from 'three';

export type InsectSpecies = 'blackAnt' | 'blueBeetle' | 'greenSpitter';
export const INSECT_SPECIES: Record<string, InsectSpecies> = {
  'fauna.blackAnt': 'blackAnt', 'fauna.blueBeetle': 'blueBeetle', 'fauna.greenSpitter': 'greenSpitter',
};
export const SPECIES_CODE: Record<InsectSpecies, number> = { blackAnt: 0, blueBeetle: 1, greenSpitter: 2 };
/** Authored geometry and all rig translations share this species scale. */
export const INSECT_SCALE = [0.65, 1, 1] as const;
export interface InsectPart { group: number; pivot: THREE.Vector3Tuple; anim: number }
export const HEAD_PIVOTS: THREE.Vector3Tuple[] = [[0, 0.66, 0.43], [0, 0.65, 0.59], [0, 0.65, 0.35]];
export const ABDOMEN_PIVOTS: THREE.Vector3Tuple[] = [[0, 0.66, -0.48], [0, 0.63, 0.1], [0, 0.77, -0.42]];

export function classifyInsectPart(name: string, anim: number, pivot: THREE.Vector3Tuple): InsectPart {
  let group = 1;
  if (anim === 6) group = 7;
  else if (anim === 16) group = 8;
  else if (anim === 49) group = 4;
  else if (anim === 59) group = 5;
  else if (name.includes('secretory sac')) group = 6;
  else if (/head|compound eye|cephalic horn|oral acid gland/.test(name)) group = 2;
  else if (/gaster|arched abdomen/.test(name)) group = 3;
  return { group, pivot, anim };
}

/** Anatomy tags are added to cached geometry; original tessellation/material zones stay untouched. */
export function stampInsectRig(geometry: THREE.BufferGeometry): void {
  const anim = geometry.getAttribute('aPartAnim');
  const tags = new Float32Array(anim.count);
  const parts = geometry.userData.partRanges as { name: string; start: number; count: number }[];
  for (const part of parts) {
    const i = part.start;
    const group = classifyInsectPart(part.name, Math.round(anim.getX(i)), [anim.getY(i), anim.getZ(i), anim.getW(i)]).group;
    tags.fill(group, part.start, part.start + part.count);
  }
  geometry.setAttribute('aInsectPart', new THREE.BufferAttribute(tags, 1));
  if (geometry.boundingSphere) geometry.boundingSphere.radius *= 1.25;
}
