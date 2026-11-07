import * as THREE from 'three';
import { FAUNA_HIVE_ZONES, type FaunaVisualSpecies } from '../../faunaVisualRegistry';
import type { KitbashBuilder, MaterialZoneId } from '../../KitbashRegistry';
import { organ, tendril, tissue } from '../../greebles/organic/shapes';
import { habitatVault, type HabitatShape } from '../../greebles/organic/habitat';
import type { V3 } from '../../greebles/unitParts';
import { register } from './common';

/** Clear openings include lateral leg reach, antennae and the spitter's raised sacs. */
export const HIVE_HABITATS: Record<FaunaVisualSpecies, HabitatShape> = {
  blackAnt: { width: 4.4, height: 1.95, depth: 4.2, mouthWidth: 1.40, mouthHeight: 1.05, tunnelDepth: 2.65, front: 1.65, kind: 4, seed: 1 },
  blueBeetle: { width: 5.7, height: 2.55, depth: 4.9, mouthWidth: 3.15, mouthHeight: 1.75, tunnelDepth: 3.15, front: 2.05, kind: 1, seed: 3 },
  greenSpitter: { width: 4.9, height: 2.75, depth: 4.5, mouthWidth: 2.05, mouthHeight: 1.95, tunnelDepth: 2.85, front: 1.85, kind: 2, seed: 6 },
};
function lobe(b: KitbashBuilder, name: string, size: V3, position: V3, zone: MaterialZoneId = 'hullPrimary', soil = true): void {
  b.addPart(organ(size, soil ? 4 : 1, position[0] * 7, soil ? 0.045 : 0.025, 10), zone, { name, position: [position[0], Math.max(position[1], size[1] * 1.046), position[2]] });
}
function vault(b: KitbashBuilder, species: FaunaVisualSpecies): void {
  b.addPart(habitatVault(HIVE_HABITATS[species]), 'hullPrimary', { name: 'continuous hollow habitat' });
}
function antMound(b: KitbashBuilder): void {
  vault(b, 'blackAnt');
  // Buttresses grow from the outside wall; the central entrance remains clear.
  for (const s of [-1, 1]) {
    lobe(b, `${s} eroded earth buttress`, [0.63, 0.64, 1.24], [s * 1.69, 0.59, -0.18]);
    lobe(b, `${s} excavated sediment fan`, [0.68, 0.16, 0.81], [s * 1.43, 0.16, 1.18], 'hullSecondary');
    b.addPart(tendril([[s * 1.98, 0.25, -0.95], [s * 1.72, 0.85, -1.20], [s * 1.04, 1.72, -1.21],
      [s * 0.42, 1.98, -1.04]], [0.14, 0.12, 0.08, 0.025], 4, 10, 6), 'hullSecondary', { name: `${s} exposed root seam` });
  }
  lobe(b, 'slumped rear sediment', [0.81, 0.47, 0.64], [0.14, 0.47, -2.48], 'frameGunmetal', false);
}
function beetleNest(b: KitbashBuilder): void {
  vault(b, 'blueBeetle');
  for (const s of [-1, 1]) {
    lobe(b, `${s} grounded molted shell`, [0.61, 0.87, 1.59], [s * 2.24, 0.84, -0.16], 'hullPrimary', false);
    // Overlapping shell ridges follow the roof, never cross the mouth.
    b.addPart(tendril([[s * 2.50, 0.49, -1.05], [s * 2.16, 1.65, -1.19], [s * 1.20, 2.48, -1.12],
      [s * 0.14, 2.70, -0.92]], [0.20, 0.18, 0.13, 0.055], 1, 12, 7), 'hullSecondary', { name: `${s} shell growth ridge` });
    lobe(b, `${s} front shell foot`, [0.40, 0.30, 0.68], [s * 2.42, 0.30, 1.65], 'frameGunmetal', true);
  }
  lobe(b, 'rear shell anchor', [1.01, 0.54, 0.69], [0, 0.54, -2.35], 'frameGunmetal', false);
}
function chimney(b: KitbashBuilder, position: V3, height: number, radius: number, seed: number): void {
  const profile = [[0.01, 0], [radius * 1.5, 0], [radius, height * 0.35], [radius * 0.78, height * 0.75],
    [radius * 0.98, height], [radius * 0.68, height], [radius * 0.48, height * 0.72], [0.01, height * 0.24], [0.01, 0]];
  const g = new THREE.LatheGeometry(profile.map(p => new THREE.Vector2(...p as [number, number])), 12);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, x);
    const folds = 1 + 0.10 * Math.sin(a * 7 + seed) * Math.sin(y / height * Math.PI);
    p.setXYZ(i, x * folds + 0.12 * (y / height) ** 2, y, z * folds);
  }
  g.computeVertexNormals();
  b.addPart(tissue(g, 2), 'frameGunmetal', { name: `hollow fluted chimney ${seed}`, position });
}
function spitterHive(b: KitbashBuilder): void {
  vault(b, 'greenSpitter');
  chimney(b, [-0.70, 2.25, -0.70], 1.30, 0.39, 1);
  chimney(b, [0.65, 2.12, -1.15], 1.08, 0.36, 2);
  for (const s of [-1, 1]) {
    lobe(b, `${s} rooted resin fold`, [0.55, 0.71, 1.27], [s * 1.94, 0.70, -0.27], 'frameGunmetal', false);
    b.addPart(organ([0.41, 0.53, 0.60], 3, s, 0.045, 10), 'hullSecondary', {
      name: `${s} attached brood sac`, position: [s * 2.35, 1.63, -0.12], animType: 60, animPivot: [s * 2.12, 1.43, -0.12],
    });
  }
  lobe(b, 'rear resin root', [0.91, 0.47, 0.73], [0, 0.47, -2.20], 'frameGunmetal', false);
}
for (const [species, label, build] of [
  ['blackAnt', 'Black Ant Mound', antMound],
  ['blueBeetle', 'Armored Beetle Nest', beetleNest],
  ['greenSpitter', 'Acid Spitter Hive', spitterHive],
] as const) register({
  id: `fauna.hive.${species}`, label, category: 'fauna', footprint: [6, 6],
  zones: FAUNA_HIVE_ZONES[species], build,
  notes: 'Continuous hollow habitat, species-sized walking clearance, joined earth/shell/resin growth and a deep recessed chamber.',
});
