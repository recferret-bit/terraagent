// Extraction & storage: mine, water pump, supply depot.
import * as THREE from 'three';
import { KitbashBuilder } from '../../KitbashRegistry';
import { box, cyl, ball, ring, strut, cable, lamp, glow, plinth, lattice, type V3, spin } from './kit';

const PI = Math.PI;

// ---------------------------------------------------------------- Mine (2x2): drill rig
export function mine() {
  const b = new KitbashBuilder();
  plinth(b, 4, 4);
  ring(b, 'frameGunmetal', 0.9, 0.18, [0, 0.3, 0.1], { seg: 20 });
  cyl(b, 'glassVisor', 0.75, 0.75, 0.04, [0, 0.2, 0.1], { seg: 20 });
  // derrick
  lattice(b, 1.0, 0.45, 0.2, 5.0, 4, 0.07);
  for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) box(b, 'hullSecondary', [0.28, 0.3, 0.28], [dx * 1.0, 0.2, dz * 1.0 + 0.1], { r: 0.05 });
  box(b, 'hullSecondary', [1.3, 0.35, 1.3], [0, 5.0, 0.1], { r: 0.1 });
  box(b, 'hullPrimary', [0.9, 0.5, 0.9], [0, 5.35, 0.1], { r: 0.1 });
  // spinning drill string (asymmetric flutes so rotation reads)
  const A = spin(0, 0.1);
  cyl(b, 'frameGunmetal', 0.22, 0.22, 4.6, [0, 0.4, 0.1], { seg: 8, ...A });
  for (let k = 0; k < 6; k++) {
    const an = k * 1.1;
    box(b, k % 2 ? 'warningAmber' : 'hullSecondary', [0.3, 0.5, 0.16], [Math.cos(an) * 0.3, 0.6 + k * 0.7, 0.1 + Math.sin(an) * 0.3], { r: 0.03, seg: 1, rotation: [0, -an, 0], ...A } as any);
  }
  b.addPart(new THREE.ConeGeometry(0.34, 0.6, 8), 'frameGunmetal', { position: [0, 0.5, 0.1], rotation: [PI, 0, 0], ...A });
  // rotating carousel flange near top
  cyl(b, 'frameGunmetal', 0.5, 0.5, 0.1, [0, 4.75, 0.1], { seg: 12, ...A });
  for (let k = 0; k < 4; k++) { const an = (k * PI) / 2; box(b, 'energyCyan', [0.14, 0.08, 0.14], [Math.cos(an) * 0.48, 4.85, 0.1 + Math.sin(an) * 0.48], { seg: 1, r: 0.01, ...A }); }
  // control hut + ore bin
  box(b, 'hullPrimary', [1.1, 0.9, 0.9], [-1.2, 0.2, -1.4], { r: 0.1 });
  glow(b, 'energyCyan', [0.6, 0.18, 0.05], [-1.2, 0.65, -0.93]);
  box(b, 'hullSecondary', [1.2, 0.7, 0.9], [1.2, 0.2, -1.4], { r: 0.08 });
  b.addPart(new THREE.IcosahedronGeometry(0.35, 0), 'frameGunmetal', { position: [1.2, 1.0, -1.4], scale: [1.2, 0.8, 1] });
  strut(b, 'frameGunmetal', [0.9, 0.3, -1.0], [0.5, 0.6, 0.3], 0.1);
  cable(b, [-1.2, 1.1, -1.4], [-0.4, 4.9, 0.4], 0.8, 0.04);
  lamp(b, 'warningAmber', 0.12, [0.0, 5.95, 0.1]);
  return b.build();
}

// ---------------------------------------------------------------- Water pump (1x1): spherical tower
export function waterPump() {
  const b = new KitbashBuilder();
  plinth(b, 2, 2);
  box(b, 'hullPrimary', [0.9, 0.75, 0.8], [-0.4, 0.2, 0.4], { r: 0.1 });
  glow(b, 'energyCyan', [0.5, 0.1, 0.04], [-0.4, 0.7, 0.82]);
  for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) strut(b, 'frameGunmetal', [dx * 0.55, 0.2, dz * 0.55 - 0.2], [dx * 0.25, 2.3, dz * 0.25 - 0.2], 0.05);
  ring(b, 'frameGunmetal', 0.45, 0.04, [0, 1.2, -0.2], { seg: 12 });
  cyl(b, 'frameGunmetal', 0.4, 0.5, 0.2, [0, 2.2, -0.2], { seg: 12 });
  ball(b, 'hullPrimary', 0.82, [0, 3.1, -0.2], { seg: 20 });
  ring(b, 'energyCyan', 0.82, 0.05, [0, 3.1, -0.2], { seg: 28 });
  ring(b, 'hullSecondary', 0.7, 0.06, [0, 3.6, -0.2], { seg: 24 });
  cyl(b, 'frameGunmetal', 0.08, 0.1, 0.4, [0, 3.85, -0.2], { seg: 8 });
  lamp(b, 'warningAmber', 0.09, [0, 4.35, -0.2]);
  glow(b, 'energyCyan', [0.06, 1.2, 0.06], [0.0, 2.5, 0.6 - 0.2]);
  // pipes pump -> tank, intake ground pipe
  strut(b, 'hullSecondary', [-0.2, 0.9, 0.4], [0.2, 2.3, 0.0], 0.09);
  b.addPart(new THREE.TorusGeometry(0.3, 0.09, 8, 14, PI / 2), 'hullSecondary', { position: [0.6, 0.45, 0.4], rotation: [0, 0, PI / 2] });
  cyl(b, 'frameGunmetal', 0.14, 0.14, 0.9, [0.78, 0.2, 0.55], { seg: 8, rotation: [PI / 2, 0, 0] } as any);
  cable(b, [-0.8, 0.9, 0.4], [-0.5, 2.5, -0.6], 0.3, 0.03);
  return b.build();
}

// ---------------------------------------------------------------- Supply depot (2x2)
export function supplyDepot() {
  const b = new KitbashBuilder();
  plinth(b, 4, 4);
  box(b, 'hullPrimary', [3.2, 1.3, 2.4], [-0.1, 0.2, -0.8], { r: 0.12, seg: 3 });
  // barrel vault roof
  b.addPart(new THREE.CylinderGeometry(1.25, 1.25, 3.3, 24), 'hullSecondary', { position: [-0.1, 1.5, -0.8], rotation: [0, 0, PI / 2], scale: [0.45, 1, 1] });
  for (const x of [-1.6, 0.1, 1.4]) box(b, 'frameGunmetal', [0.1, 0.12, 2.5], [x, 1.38, -0.8], { r: 0.03, seg: 1 });
  // big shutter door
  box(b, 'frameGunmetal', [1.9, 1.0, 0.12], [-0.1, 0.2, 0.42], { r: 0.05 });
  glow(b, 'warningAmber', [1.5, 0.1, 0.05], [-0.1, 1.05, 0.5]);
  for (let k = 0; k < 4; k++) box(b, 'hullPrimary', [1.7, 0.05, 0.05], [-0.1, 0.35 + k * 0.17, 0.5], { r: 0.01, seg: 1 });
  // cargo crates & containers outside
  box(b, 'hullSecondary', [0.9, 0.7, 0.7], [-1.3, 0.2, 1.2], { r: 0.06 });
  box(b, 'hullPrimary', [0.7, 0.55, 0.7], [-1.3, 0.9, 1.2], { r: 0.06 });
  box(b, 'hullPrimary', [0.8, 0.6, 0.8], [-0.5, 0.2, 1.4], { r: 0.06 });
  box(b, 'frameGunmetal', [1.6, 0.8, 0.8], [1.2, 0.2, 1.3], { r: 0.06 });
  glow(b, 'energyCyan', [1.3, 0.06, 0.04], [1.2, 0.8, 1.72]);
  box(b, 'hullSecondary', [1.6, 0.7, 0.8], [1.2, 1.0, 1.3], { r: 0.06 });
  // gantry crane (silhouette)
  for (const sx of [-1, 1]) strut(b, 'frameGunmetal', [1.7 + 0.0, 0.2, -1.8 + (sx + 1) * 1.8], [1.7, 2.9, -1.8 + (sx + 1) * 1.8], 0.07);
  strut(b, 'frameGunmetal', [1.7, 2.9, -1.8], [1.7, 2.9, 1.8], 0.08);
  box(b, 'hullSecondary', [0.4, 0.3, 0.5], [1.5, 2.65, 0.4], { r: 0.05, animType: 2 } as any);
  cable(b, [1.7, 2.7, 0.4], [1.7, 1.9, 1.3], 0.15, 0.025, 'frameGunmetal');
  lamp(b, 'warningAmber', 0.1, [1.7, 3.0, -1.8]);
  lamp(b, 'warningAmber', 0.1, [1.7, 3.0, 1.8]);
  cable(b, [-1.65, 1.2, -1.6], [-1.8, 0.3, 1.0], 0.4, 0.05);
  return b.build();
}
