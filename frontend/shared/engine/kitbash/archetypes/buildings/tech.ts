// Tech & defense: drone array, robotics factory, turret.
import * as THREE from 'three';
import { KitbashBuilder } from '../../KitbashRegistry';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { box, cyl, capsule, ring, strut, cable, lamp, glow, dish, plinth, type V3, spin } from './kit';

const PI = Math.PI;

// ---------------------------------------------------------------- Drone control array (2x2)
export function droneArray() {
  const b = new KitbashBuilder();
  plinth(b, 4, 4);
  // central control tower
  box(b, 'hullPrimary', [1.4, 1.2, 1.4], [0, 0.2, -0.3], { r: 0.15, seg: 3 });
  cyl(b, 'hullPrimary', 0.45, 0.6, 1.4, [0, 1.4, -0.3], { seg: 12 });
  ring(b, 'energyCyan', 0.52, 0.05, [0, 2.0, -0.3], { seg: 20 });
  ring(b, 'energyCyan', 0.46, 0.05, [0, 2.5, -0.3], { seg: 20 });
  cyl(b, 'frameGunmetal', 0.5, 0.5, 0.15, [0, 2.8, -0.3], { seg: 12 });
  cyl(b, 'frameGunmetal', 0.07, 0.07, 1.4, [0, 2.9, -0.3], { seg: 6 });
  lamp(b, 'dangerCrimson', 0.09, [0, 4.35, -0.3]);
  // rotating dish array: 3 dishes on masts of different heights
  const dishes: [number, number, number, number][] = [[0, 4.0, -0.3, 0.7], [-1.35, 2.7, -1.1, 0.55], [1.4, 2.2, -1.2, 0.5]];
  dishes.forEach(([x, y, z, R], i) => {
    const A = spin(x, z);
    if (i > 0) { cyl(b, 'frameGunmetal', 0.07, 0.1, y - 0.7, [x, 0.2, z], { seg: 8 }); box(b, 'hullSecondary', [0.4, 0.3, 0.4], [x, 0.2, z], { r: 0.06 }); }
    cyl(b, 'frameGunmetal', 0.06, 0.06, 0.45, [x, y - 0.45, z], { seg: 6, ...A });
    dish(b, R, [x, y, z], -0.6 - i * 0.15, A);
    b.addPart(new THREE.CylinderGeometry(0.025, 0.025, 0.5, 5), 'frameGunmetal', { position: [x, y + 0.3, z + 0.18], rotation: [0.5, 0, 0], ...A });
    b.addPart(new THREE.SphereGeometry(0.07, 8, 6), 'energyCyan', { position: [x, y + 0.5, z + 0.3], ...A });
  });
  // landing pads + hovering drone
  for (const [x, z] of [[-1.2, 1.2], [0.3, 1.4]] as [number, number][]) {
    cyl(b, 'frameGunmetal', 0.5, 0.5, 0.1, [x, 0.2, z], { seg: 20 });
    ring(b, 'warningAmber', 0.4, 0.03, [x, 0.32, z], { seg: 20 });
  }
  const dx = 0.3, dz = 1.4, dy = 1.0;
  const bob = { animType: 2 as const };
  b.addPart(new THREE.SphereGeometry(0.22, 12, 8), 'hullPrimary', { position: [dx, dy, dz], scale: [1, 0.55, 1], ...bob });
  b.addPart(new THREE.SphereGeometry(0.08, 8, 6), 'energyCyan', { position: [dx, dy - 0.07, dz + 0.17], ...bob });
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    strut(b, 'frameGunmetal', [dx, dy, dz], [dx + sx * 0.38, dy + 0.05, dz + sz * 0.38], 0.025, bob);
    cyl(b, 'hullSecondary', 0.17, 0.17, 0.02, [dx + sx * 0.38, dy + 0.06, dz + sz * 0.38], { seg: 10, ...bob });
  }
  // docked drone on other pad
  box(b, 'hullPrimary', [0.35, 0.14, 0.35], [-1.2, 0.3, 1.2], { r: 0.05 });
  lamp(b, 'energyCyan', 0.05, [-1.2, 0.5, 1.4]);
  cable(b, [0.5, 1.2, 0.2], [1.2, 0.3, 1.5], 0.35, 0.05);
  cable(b, [0, 2.7, -0.3], [-1.35, 2.1, -1.1], 0.4, 0.03);
  return b.build();
}

// ---------------------------------------------------------------- Robotics factory (4x3)
export function roboticsFactory() {
  const b = new KitbashBuilder();
  plinth(b, 8, 6);
  box(b, 'hullPrimary', [6.0, 2.0, 3.6], [-0.6, 0.2, -0.9], { r: 0.2, seg: 3 });
  box(b, 'frameGunmetal', [6.1, 0.2, 3.7], [-0.6, 1.4, -0.9], { r: 0.05 });
  // sawtooth roof
  for (let k = 0; k < 3; k++) {
    const x = -2.4 + k * 1.8;
    box(b, 'hullPrimary', [1.7, 0.7, 0.1], [x, 2.2, 0.8], { r: 0.03, seg: 1 });
    b.addPart(new RoundedBoxGeometry(1.7, 0.06, 1.8, 1, 0.02), 'hullSecondary', { position: [x, 2.65, -0.15], rotation: [0.22, 0, 0] });
    glow(b, 'energyCyan', [1.5, 0.45, 0.04], [x, 2.28, 0.74], { emissiveIntensity: 3.2 });
  }
  // roof gantry rails + trolley + arm
  for (const z of [-2.0, 0.2]) box(b, 'frameGunmetal', [6.2, 0.15, 0.15], [-0.6, 3.15, z], { r: 0.03, seg: 1 });
  for (const x of [-3.6, 2.4]) { for (const z of [-2.0, 0.2]) cyl(b, 'frameGunmetal', 0.08, 0.08, 1.0, [x, 2.2, z], { seg: 6 }); box(b, 'frameGunmetal', [0.15, 0.15, 2.4], [x, 3.15, -0.9], { r: 0.03, seg: 1 }); }
  box(b, 'hullSecondary', [0.8, 0.35, 0.8], [0.2, 3.3, -0.9], { r: 0.08 });
  strut(b, 'frameGunmetal', [0.2, 3.3, -0.9], [0.2, 2.5, 0.6], 0.07);
  strut(b, 'frameGunmetal', [0.2, 2.5, 0.6], [0.2, 1.9, 1.7], 0.06, { animType: 2 });
  box(b, 'hullSecondary', [0.35, 0.25, 0.5], [0.05, 1.65, 1.7], { r: 0.05, animType: 2 } as any);
  lamp(b, 'energyCyan', 0.08, [0.2, 1.55, 2.0], { animType: 2 });
  // big roller door + amber hazard
  box(b, 'frameGunmetal', [2.6, 1.5, 0.2], [-2.3, 0.2, 0.95], { r: 0.06 });
  glow(b, 'warningAmber', [2.2, 0.1, 0.05], [-2.3, 1.45, 1.07]);
  // conveyor out front with robot torso in progress
  box(b, 'frameGunmetal', [4.8, 0.35, 1.0], [0.3, 0.2, 2.1], { r: 0.1 });
  glow(b, 'energyCyan', [4.6, 0.04, 0.06], [0.3, 0.55, 2.55]);
  for (let k = 0; k < 8; k++) cyl(b, 'hullSecondary', 0.1, 0.1, 0.9, [-1.9 + k * 0.6, 0.55, 2.1], { seg: 8, rotation: [PI / 2, 0, 0] } as any);
  box(b, 'hullPrimary', [0.55, 0.4, 0.5], [-0.9, 0.55, 2.1], { r: 0.08 });
  box(b, 'hullSecondary', [0.3, 0.3, 0.3], [-0.9, 0.95, 2.1], { r: 0.06 });
  glow(b, 'energyCyan', [0.2, 0.05, 0.04], [-0.9, 1.08, 2.27]);
  box(b, 'hullPrimary', [0.5, 0.35, 0.5], [1.4, 0.55, 2.1], { r: 0.08 });
  // side chimney vents + silo tank
  for (const [x, h] of [[-3.2, 3.2], [-2.7, 2.7]] as [number, number][]) { cyl(b, 'frameGunmetal', 0.18, 0.22, h - 1.6, [x, 1.6, -2.0], { seg: 10 }); ring(b, 'warningAmber', 0.19, 0.03, [x, h - 0.1, -2.0], { seg: 10 }); }
  capsule(b, 'hullSecondary', 0.55, 1.4, [3.0, 0.2, -1.6], { seg: 14 });
  ring(b, 'energyCyan', 0.56, 0.035, [3.0, 1.0, -1.6], { seg: 16 });
  strut(b, 'frameGunmetal', [3.0, 2.4, -1.6], [2.4, 2.3, -0.9], 0.07);
  // antenna + sagging cables
  strut(b, 'frameGunmetal', [-3.0, 1.6, 0.0], [-3.3, 4.6, 0.1], 0.05);
  lamp(b, 'dangerCrimson', 0.1, [-3.3, 4.7, 0.1]);
  cable(b, [-3.3, 4.3, 0.1], [-2.0, 3.15, -2.0], 0.6, 0.025);
  cable(b, [3.0, 1.8, -1.0], [3.4, 0.5, 1.8], 0.5, 0.06);
  return b.build();
}

// ---------------------------------------------------------------- Turret (1x1)
export function turret() {
  const b = new KitbashBuilder();
  plinth(b, 2, 2);
  cyl(b, 'frameGunmetal', 0.8, 0.9, 0.35, [0, 0.2, 0], { seg: 8 });
  cyl(b, 'hullPrimary', 0.6, 0.72, 0.55, [0, 0.55, 0], { seg: 8 });
  ring(b, 'warningAmber', 0.66, 0.04, [0, 0.75, 0], { seg: 8 });
  cyl(b, 'frameGunmetal', 0.45, 0.45, 0.2, [0, 1.1, 0], { seg: 12 });
  // sensor head (rotates)
  const A = spin(0, 0);
  box(b, 'hullPrimary', [0.9, 0.5, 1.0], [0, 1.25, 0], { r: 0.12, seg: 3, ...A } as any);
  box(b, 'hullSecondary', [0.95, 0.12, 0.5], [0, 1.6, -0.15], { r: 0.04, ...A } as any);
  dish(b, 0.28, [0, 2.15, -0.15], -0.7, A);
  cyl(b, 'frameGunmetal', 0.04, 0.04, 0.4, [0, 1.7, -0.15], { seg: 6, ...A });
  lamp(b, 'energyCyan', 0.07, [0, 2.3, 0], A);
  // twin barrels with recoil tag (static yaw; mesh is yawed by game)
  const R3 = { animType: 3 as const, animPivot: [0, 1.5, 0.5] as V3 };
  for (const sx of [-1, 1]) {
    cyl(b, 'frameGunmetal', 0.1, 0.12, 1.1, [sx * 0.3, 1.5, 0.55], { seg: 10, rotation: [PI / 2, 0, 0], ...R3 } as any);
    cyl(b, 'frameGunmetal', 0.07, 0.07, 0.6, [sx * 0.3, 1.5, 1.4], { seg: 8, rotation: [PI / 2, 0, 0], ...R3 } as any);
    ring(b, 'hullSecondary', 0.13, 0.03, [sx * 0.3, 1.5, 0.95], { rotation: [0, 0, 0], ...R3 } as any);
    glow(b, 'warningAmber', [0.1, 0.1, 0.1], [sx * 0.3 - 0.05, 1.45, 1.72], { ...R3 } as any);
  }
  box(b, 'frameGunmetal', [0.9, 0.25, 0.4], [0, 1.4, 0.55], { r: 0.05, ...R3 } as any);
  // ammo box + cable
  box(b, 'hullSecondary', [0.4, 0.4, 0.4], [-0.8, 0.2, 0.4], { r: 0.05 });
  cable(b, [-0.8, 0.5, 0.4], [-0.45, 1.3, 0.1], 0.2, 0.035);
  return b.build();
}
