import * as THREE from 'three';
import { insectPartMatrix, type InsectPose } from './pose';
import { classifyInsectPart } from './rig';
import type { PartDef } from '../../kitbash/validate/types';

export function insectValidationStates(species: number): Array<{ label: string; pose: InsectPose }> {
  const base: InsectPose = { species, time: 0, walk: 0, charge: 0, strike: 0, hurt: 0, death: 0 };
  const out: Array<{ label: string; pose: InsectPose }> = [];
  for (let i = 0; i < 12; i++) out.push({ label: `insect tripod ${i}`, pose: { ...base, time: i * Math.PI * 2 / 60, walk: 1 } });
  for (let i = 0; i < 12; i++) out.push({ label: `insect moving recovery ${i}`, pose: { ...base, time: i * Math.PI * 2 / 60, walk: 1, strike: 0.7, charge: 0.2 } });
  for (let i = 0; i <= 4; i++) {
    const u = i / 4;
    out.push({ label: `insect inertial blend ${i}`, pose: { ...base, time: u, charge: u, strike: 1 - u } });
    out.push({ label: `insect loaded strike ${i}`, pose: { ...base, time: u, charge: 1, strike: 1, hurt: u } });
    out.push({ label: `insect idle ${i}`, pose: { ...base, time: u * 2 } });
    out.push({ label: `insect windup ${i}`, pose: { ...base, time: u, charge: u } });
    out.push({ label: `insect strike ${i}`, pose: { ...base, time: u, strike: u } });
    out.push({ label: `insect hurt ${i}`, pose: { ...base, time: u, hurt: u } });
    out.push({ label: `insect death ${i}`, pose: { ...base, time: u, death: u } });
    out.push({ label: `insect windup hurt ${i}`, pose: { ...base, time: u, charge: u, hurt: 1 } });
    out.push({ label: `insect strike hurt ${i}`, pose: { ...base, time: u, strike: u, hurt: 1 } });
    out.push({ label: `insect windup death ${i}`, pose: { ...base, time: u, charge: 1, death: u } });
    out.push({ label: `insect strike death ${i}`, pose: { ...base, time: u, strike: 1, death: u } });
  }
  if (species === 2) out.push(...out.map(sample => ({ label: `${sample.label} right sac`, pose: { ...sample.pose, sacSide: 1 } })));
  return out;
}
export function insectPartPoses(part: PartDef): Array<{ label: string; tris: Float32Array }> {
  const rig = classifyInsectPart(part.name, part.animType, part.pivot);
  return insectValidationStates(part.insectSpecies!).map(({ label, pose }) => {
    const matrix = insectPartMatrix(rig, pose);
    const tris = new Float32Array(part.tris.length);
    const point = new THREE.Vector3();
    for (let i = 0; i < tris.length; i += 3) {
      point.fromArray(part.tris, i).applyMatrix4(matrix);
      tris.set(point.toArray(), i);
    }
    return { label, tris };
  });
}
