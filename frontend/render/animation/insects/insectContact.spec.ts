import * as THREE from 'three';
import { expect, it } from 'vitest';
import { extractArchetype } from '../../kitbash/validate/extract';
import { insectPartMatrix, type InsectPose } from './pose';
import { classifyInsectPart } from './rig';
import '../../kitbash/index';

/** Bug-attack gallery opponents stand two metres apart; the armored scout presents its side. */
function hornDistance(strike: number, charge: number): number {
  const horn = extractArchetype('fauna.blueBeetle').parts.find(part => part.name === 'curved cephalic horn')!;
  const pose: InsectPose = { species: 1, time: 0, walk: 0, charge, strike, hurt: 0, death: 0 };
  const matrix = insectPartMatrix(classifyInsectPart(horn.name, horn.animType, horn.pivot), pose);
  const opponent = new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(0, 0, 2);
  const points: THREE.Vector3[] = [];
  for (let i = 0; i < horn.tris.length; i += 3) points.push(new THREE.Vector3().fromArray(horn.tris, i).applyMatrix4(matrix));
  let distance = Infinity;
  const triangle = new THREE.Triangle(), closest = new THREE.Vector3();
  for (const part of extractArchetype('robot.recon').parts) {
    for (let i = 0; i < part.tris.length; i += 9) {
      triangle.a.fromArray(part.tris, i).applyMatrix4(opponent);
      triangle.b.fromArray(part.tris, i + 3).applyMatrix4(opponent);
      triangle.c.fromArray(part.tris, i + 6).applyMatrix4(opponent);
      for (const point of points) distance = Math.min(distance, triangle.closestPointToPoint(point, closest).distanceTo(point));
    }
  }
  return distance;
}

it('beetle horn reaches the recon surface at release and clears it during anticipation', () => {
  expect(hornDistance(1, 0)).toBeLessThan(0.04);
  expect(hornDistance(0, 1)).toBeGreaterThan(0.12);
});
