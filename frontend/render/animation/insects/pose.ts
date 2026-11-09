import * as THREE from 'three';
import { ABDOMEN_PIVOTS, HEAD_PIVOTS, INSECT_SCALE, type InsectPart } from './rig';

export interface InsectPose { species: number; time: number; walk: number; charge: number; strike: number; hurt: number; death: number; sacSide?: number }
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const ONE = new THREE.Vector3(1, 1, 1);

function rigid(rest: THREE.Vector3, anchor: THREE.Vector3, q: THREE.Quaternion, scale = 1): THREE.Matrix4 {
  return new THREE.Matrix4().compose(anchor, q, ONE.clone().multiplyScalar(scale))
    .multiply(new THREE.Matrix4().makeTranslation(-rest.x, -rest.y, -rest.z));
}
function rotation(pivot: THREE.Vector3Tuple, axis: THREE.Vector3, angle: number): THREE.Matrix4 {
  const p = new THREE.Vector3(...pivot);
  return rigid(p, p, new THREE.Quaternion().setFromAxisAngle(axis, angle));
}

export function insectBodyMatrix(p: InsectPose): THREE.Matrix4 {
  const alive = 1 - p.death;
  const g = p.time * 5;
  const w = p.walk * alive * (1 - Math.max(p.charge, p.strike));
  const c = p.charge * alive, a = p.strike * alive, h = p.hurt * alive;
  const beetle = p.species === 1;
  const pitch = Math.sin(g * 2 - 0.45) * 0.036 * w + (beetle ? 0.075 * c + 0.04 * a : -0.045 * c + 0.06 * a);
  const roll = Math.sin(g - 0.25) * 0.045 * w + Math.sin(g * 4) * 0.045 * h;
  const q = new THREE.Quaternion().setFromAxisAngle(X, pitch)
    .multiply(new THREE.Quaternion().setFromAxisAngle(Z, roll));
  const drop = beetle ? 0.385 : 0.43;
  const anchor = new THREE.Vector3(Math.cos(g) * 0.022 * w,
    0.76 + (-Math.cos(g * 2) * 0.02 - Math.sin(g * 2) * 0.01) * w - 0.025 * c - drop * p.death * p.death,
    Math.sin(g * 2) * 0.018 * w - 0.035 * c + (beetle ? 0.16 : 0.26) * a - 0.05 * h);
  return rigid(new THREE.Vector3(0, 0.76, 0), anchor, q);
}

export function insectHeadMatrix(p: InsectPose): THREE.Matrix4 {
  const alive = 1 - p.death;
  const angle = p.species === 1 ? 0.13 * p.charge + 0.30 * p.strike : -0.07 * p.charge + 0.10 * p.strike;
  return rotation(HEAD_PIVOTS[p.species]!, X, angle * alive + 0.08 * p.death);
}
export function insectAbdomenMatrix(p: InsectPose): THREE.Matrix4 {
  const angle = p.species === 2 ? 0.34 * p.charge - 0.14 * p.strike : Math.sin(p.time * 2.1) * 0.012;
  return rotation(ABDOMEN_PIVOTS[p.species]!, X, angle * (1 - p.death));
}

/** Closed-form two-link placement keeps each foot planted while the body braces/lunges. */
function legMatrix(part: InsectPart, p: InsectPose, body: THREE.Matrix4): THREE.Matrix4 {
  const hip0 = new THREE.Vector3(...part.pivot);
  const side = Math.sign(hip0.x);
  const knee0 = new THREE.Vector3(hip0.x * 2, hip0.y + 0.24, hip0.z * 1.5);
  const toe0 = new THREE.Vector3(hip0.x * 2 + side * 0.12, 0.027, hip0.z * 1.75);
  const hip = hip0.clone().applyMatrix4(body);
  if (p.death > 0) {
    const upperQ = new THREE.Quaternion().setFromAxisAngle(Z, side * -0.1 * p.death);
    const knee = knee0.clone().sub(hip0).applyQuaternion(upperQ).add(hip);
    return part.group === 7 ? rigid(hip0, hip, upperQ)
      : rigid(knee0, knee, new THREE.Quaternion().setFromAxisAngle(Z, side * 1.15 * p.death));
  }
  const phase = p.time * 5 + (side > 0 ? 0 : Math.PI) + (Math.abs(hip0.z) > 0.1 ? Math.PI : 0);
  const walk = p.walk * (1 - p.death) * (1 - Math.max(p.charge, p.strike));
  const toe = toe0.clone();
  toe.z += Math.sin(phase) * 0.13 * walk;
  toe.y += 0.025 * walk + (p.species === 1 ? 0.015 : 0.035) * p.strike;
  toe.y += Math.pow(Math.max(0, Math.cos(phase)), 0.8) * 0.085 * walk;
  const l1 = hip0.distanceTo(knee0), l2 = knee0.distanceTo(toe0);
  const axis = toe.clone().sub(hip).normalize();
  const distance = THREE.MathUtils.clamp(hip.distanceTo(toe), Math.abs(l2 - l1) + 0.0001, l1 + l2 - 0.0001);
  toe.copy(hip).addScaledVector(axis, distance);
  const bend = knee0.clone().sub(hip0);
  bend.addScaledVector(axis, -bend.dot(axis)).normalize();
  const along = (l1 * l1 - l2 * l2 + distance * distance) / (2 * distance);
  const knee = hip.clone().addScaledVector(axis, along).addScaledVector(bend, Math.sqrt(Math.max(0, l1 * l1 - along * along)));
  const upper = part.group === 7;
  const rest = upper ? hip0 : knee0;
  const origin = upper ? hip : knee;
  const oldAxis = (upper ? knee0.clone().sub(hip0) : toe0.clone().sub(knee0)).normalize();
  const newAxis = (upper ? knee.clone().sub(hip) : toe.clone().sub(knee)).normalize();
  return rigid(rest, origin, new THREE.Quaternion().setFromUnitVectors(oldAxis, newAxis));
}

function authoredPartMatrix(part: InsectPart, p: InsectPose): THREE.Matrix4 {
  const body = insectBodyMatrix(p);
  if (part.group >= 7) return legMatrix(part, p, body);
  if (part.group === 3 || part.group === 6) {
    body.multiply(insectAbdomenMatrix(p));
    if (part.group === 6) {
      const active = Math.sign(part.pivot[0]) === (p.sacSide ?? -1) ? 1 : 0;
      const pulse = (0.025 * Math.sin(p.time * 5 + part.pivot[0] * 3)
        + 0.18 * p.charge * (0.3 + 0.7 * active) - 0.10 * p.strike * active) * (1 - p.death);
      const pivot = new THREE.Vector3(...part.pivot);
      body.multiply(rigid(pivot, pivot, new THREE.Quaternion(), 1 + pulse));
    }
  } else if (part.group >= 2 && part.group <= 5) {
    body.multiply(insectHeadMatrix(p));
    const side = part.pivot[0] >= 0 ? 1 : -1;
    if (part.group === 4) body.multiply(rotation(part.pivot, Y, side * (0.04 + 0.34 * p.charge - 0.04 * p.strike) * (1 - p.death)));
    if (part.group === 5) body.multiply(rotation(part.pivot, Y, side * (0.09 * Math.sin(p.time * 4 + part.pivot[0] * 9)
      + 0.03 * Math.sin(p.time * 9) - 0.12 * p.charge) * (1 - p.death)));
  }
  return body;
}

/** Conjugate the authored rig into the final geometry's units, including its pivots. */
export function insectPartMatrix(part: InsectPart, p: InsectPose): THREE.Matrix4 {
  const scale = INSECT_SCALE[p.species] ?? 1;
  const pivot = part.pivot.map(v => v / scale) as THREE.Vector3Tuple;
  const matrix = authoredPartMatrix({ ...part, pivot }, p);
  // Uniform scale cancels from the rotation; only the final translation changes.
  matrix.elements[12] *= scale;
  matrix.elements[13] *= scale;
  matrix.elements[14] *= scale;
  return matrix;
}
