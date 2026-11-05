import * as THREE from 'three';
import { FAUNA_HIVE_ZONES } from '../../faunaVisualRegistry';
import type { KitbashBuilder, MaterialZoneId } from '../../KitbashRegistry';
import { organ, tendril, burrow, tissue } from '../../greebles/organic/shapes';
import type { V3 } from '../../greebles/unitParts';
import { register } from './common';

function lobe(b: KitbashBuilder, name: string, size: V3, position: V3, zone: MaterialZoneId = 'hullPrimary', soil = true): void {
  b.addPart(organ(size, soil ? 4 : 1, position[0] * 7, soil ? 0.045 : 0.025), zone, { name, position });
}
function entrance(b: KitbashBuilder, name: string, position: V3, width: number, height: number, depth: number, yaw = 0): void {
  b.addPart(burrow(width, height, depth), 'frameGunmetal', { name, position, rotation: [0, yaw, 0] });
}
function antMound(b: KitbashBuilder): void {
  lobe(b, 'sediment apron', [1.42, 0.07, 1.22], [0, 0.07, 0]);
  lobe(b, 'rear excavated mound', [1.00, 0.58, 0.65], [0, 0.70, -0.55]);
  lobe(b, 'left earthen shoulder', [0.45, 0.42, 0.65], [-0.83, 0.44, 0.12]);
  lobe(b, 'right earthen shoulder', [0.42, 0.35, 0.60], [0.84, 0.37, 0.02]);
  entrance(b, 'deep main burrow', [0, 0.12, 0.93], 0.90, 0.65, 1.0);
  entrance(b, 'side burrow', [-0.83, 0.10, 0.58], 0.53, 0.44, 0.52, -0.55);
  for (let i = 0; i < 4; i++) {
    const x = -0.55 + i * 0.35;
    lobe(b, `eroded sediment fold ${i}`, [0.19, 0.15, 0.27], [x, 1.20 - Math.abs(x) * 0.20, -0.63], 'hullSecondary', false);
  }
  b.addPart(tendril([[0.78, 0.15, -0.60], [0.68, 0.65, -0.61], [0.38, 1.05, -0.68]], [0.12, 0.09, 0.025], 4, 7, 6), 'hullSecondary', { name: 'root bound ridge' });
}
function beetleNest(b: KitbashBuilder): void {
  lobe(b, 'soil nest bed', [1.58, 0.08, 1.30], [0, 0.08, 0]);
  lobe(b, 'rear shell vault', [1.10, 0.65, 0.70], [0, 0.78, -0.59], 'hullPrimary', false);
  entrance(b, 'wide shell burrow', [0, 0.12, 1.08], 1.55, 0.98, 1.30);
  for (const s of [-1, 1]) {
    lobe(b, `${s} lateral molted elytron`, [0.42, 0.52, 0.98], [s * 0.95, 0.49, -0.05], 'hullPrimary', false);
    lobe(b, `${s} layered shell lip`, [0.31, 0.12, 0.75], [s * 0.91, 1.03, -0.19], 'hullSecondary', false);
    b.addPart(tendril([[s * 1.24, 0.16, -0.64], [s * 1.03, 0.68, -0.79], [s * 0.64, 1.14, -0.66]],
      [0.14, 0.105, 0.03], 1, 7, 6), 'hullSecondary', { name: `${s} weathered shell crest` });
  }
  lobe(b, 'asymmetric rear molt', [0.38, 0.31, 0.44], [-0.35, 1.06, -0.64], 'hullSecondary', false);
}
function chimney(b: KitbashBuilder, position: V3, height: number, radius: number, seed: number): void {
  const profile = [[0.01, 0], [radius * 1.5, 0], [radius, height * 0.35], [radius * 0.78, height * 0.75],
    [radius * 0.98, height], [radius * 0.68, height], [radius * 0.48, height * 0.72], [0.01, height * 0.24], [0.01, 0]];
  const g = new THREE.LatheGeometry(profile.map(p => new THREE.Vector2(...p as [number, number])), 16);
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
  lobe(b, 'resin bed', [1.40, 0.14, 1.20], [0, 0.14, 0]);
  lobe(b, 'rear living mound', [0.94, 0.48, 0.63], [0, 0.47, -0.48]);
  entrance(b, 'resin burrow', [-0.32, 0.12, 0.93], 0.91, 0.72, 1.02);
  chimney(b, [-0.36, 0.64, -0.54], 1.05, 0.24, 1);
  chimney(b, [0.36, 0.53, -0.60], 0.84, 0.23, 2);
  chimney(b, [-0.87, 0.20, -0.18], 0.72, 0.20, 3);
  for (const [i, x, y, z] of [[0, 0.85, 0.38, -0.15], [1, -0.76, 0.30, -0.60], [2, 0.32, 0.45, -0.94]]) {
    b.addPart(organ([0.29, 0.32, 0.31], 3, i, 0.045, 10), 'hullSecondary', {
      name: `resin brood sac ${i}`, position: [x, y, z], animType: 60, animPivot: [x, y - 0.20, z],
    });
  }
  // A real concave cup, rotated upward, with an inset wet surface at its bottom.
  const cup = burrow(0.74, 0.74, 0.28, 2);
  cup.rotateX(-Math.PI / 2);
  b.addPart(cup, 'frameGunmetal', { name: 'secretory basin', position: [0.67, 0.39, 0.81] });
  lobe(b, 'basin resin fluid', [0.24, 0.055, 0.24], [0.67, 0.29, 0.44], 'hullSecondary', false);
}
for (const [species, label, build] of [
  ['blackAnt', 'Black Ant Mound', antMound],
  ['blueBeetle', 'Armored Beetle Nest', beetleNest],
  ['greenSpitter', 'Acid Spitter Hive', spitterHive],
] as const) register({
  id: `fauna.hive.${species}`, label, category: 'fauna', footprint: [2, 2],
  zones: FAUNA_HIVE_ZONES[species], build,
  notes: 'Organic habitat with deep burrow mouths, uneven growth, species-specific earth/shell/resin surfaces and grounded root masses.',
});
