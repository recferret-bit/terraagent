import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ArchetypeCatalog } from '../catalog';
import { HIVE_HABITATS } from '../archetypes/units/hives';
import { extractArchetype } from './extract';
import { insectPartMatrix } from '../../animation/insects/pose';
import { classifyInsectPart, SPECIES_CODE } from '../../animation/insects/rig';
import '../index';

/** Trace the actual moving silhouette down the chamber, rather than trusting its declared dimensions. */
describe('inhabited hive clearance', () => {
  for (const species of ['blackAnt', 'blueBeetle', 'greenSpitter'] as const) {
    it(`${species} walks through its entrance without hitting the roof or side growth`, () => {
      const shape = HIVE_HABITATS[species];
      const hive = new THREE.Mesh(ArchetypeCatalog.getGeometry(`fauna.hive.${species}`), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
      const rays = new THREE.Raycaster();
      const outline = new Map<string, THREE.Vector3>();
      const bug = extractArchetype(`fauna.${species}`);
      for (let step = 0; step < 12; step++) for (const part of bug.parts) {
        const matrix = insectPartMatrix(classifyInsectPart(part.name, part.animType, part.pivot), {
          species: SPECIES_CODE[species], time: step * Math.PI / 30, walk: 1, charge: 0, strike: 0, hurt: 0, death: 0,
        });
        for (let i = 0; i < part.tris.length; i += 3) {
          const point = new THREE.Vector3().fromArray(part.tris, i).applyMatrix4(matrix);
          // Retain the highest and widest vertices in each 2 cm silhouette band.
          for (const [key, axis] of [[`x${Math.round(point.x * 50)}`, 'y'], [`y${Math.round(point.y * 50)}:${Math.sign(point.x)}`, 'x']] as const) {
            const previous = outline.get(key);
            if (!previous || Math.abs(point[axis]) > Math.abs(previous[axis])) outline.set(key, point);
          }
        }
      }
      for (const point of outline.values()) {
        rays.set(new THREE.Vector3(point.x, point.y + 0.035, shape.front + 0.05), new THREE.Vector3(0, 0, -1));
        const hit = rays.intersectObject(hive, false)[0];
        expect(hit, `unsealed rear wall at ${point.toArray()}`).toBeDefined();
        expect(hit.distance, `blocked walking silhouette at ${point.x}, ${point.y}`).toBeGreaterThan(shape.tunnelDepth + 0.045);
      }
      hive.geometry.dispose(); (hive.material as THREE.Material).dispose();
    });
  }
  it('scales the complete ant and its pivots to 65% in the catalog', () => {
    const ant = ArchetypeCatalog.getGeometry('fauna.blackAnt');
    const anim = ant.getAttribute('aPartAnim');
    const hip = Array.from({ length: anim.count }, (_, i) => i).find(i => anim.getX(i) === 6)!;
    expect(Math.abs(anim.getY(hip))).toBeCloseTo(0.25 * 0.65, 6);
    expect(anim.getZ(hip)).toBeCloseTo(0.60 * 0.65, 3);
    ant.computeBoundingBox();
    expect(ant.boundingBox!.max.z - ant.boundingBox!.min.z).toBeLessThan(1.85);
    ant.dispose();
  });
});
