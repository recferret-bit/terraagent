import { gridPort } from './gridPorts';
// Extraction & storage: mine, water pump, supply depot.
import * as THREE from 'three';
import { KitbashBuilder } from '../../KitbashRegistry';
import { box, cyl, ball, ring, strut, cable, lamp, glow, plinth, lattice, spin } from './kit';

const PI = Math.PI;

// ---------------------------------------------------------------- Mine (2x2): drill rig
export function mine() {
  const b = new KitbashBuilder();
  plinth(b, 4, 4);
  ring(b, 'hullSecondary', 0.9, 0.18, [0, 0.3, 0], { seg: 12, name: 'bore collar ring' });
  cyl(b, 'hullPrimary', 0.75, 0.75, 0.08, [0, 0.18, 0], { seg: 12, name: 'bore pit collar' });
  // derrick (3 panels keeps triangle count well under budget)
  lattice(b, 1.0, 0.45, 0.18, 5.0, 3, 0.065);
  for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) cyl(b, 'hullSecondary', 0.16, 0.18, 0.3, [dx * 1.0, 0.18, dz * 1.0], { seg: 8, name: 'derrick foot pad' });
  box(b, 'hullSecondary', [1.26, 0.32, 1.26], [0, 5.02, 0], { r: 0.08, name: 'derrick crown deck' });
  box(b, 'hullPrimary', [1.06, 0.6, 1.06], [0, 5.3, 0], { r: 0.08, name: 'headframe motor house' });
  // spinning drill string (concentric with derrick at 0,0)
  const A = spin(0, 0);
  cyl(b, 'frameGunmetal', 0.18, 0.18, 4.85, [0, 0.22, 0], { seg: 8, name: 'drill kelly shaft', ...A });
  for (let k = 0; k < 5; k++) {
    const an = k * 1.25;
    box(b, k % 2 ? 'warningAmber' : 'hullSecondary', [0.22, 0.46, 0.14], [Math.cos(an) * 0.18, 0.7 + k * 0.78, Math.sin(an) * 0.18], { r: 0.03, seg: 1, rotation: [0, -an, 0], name: 'drill flute', ...A } as any);
  }
  b.addPart(new THREE.ConeGeometry(0.28, 0.55, 8), 'frameGunmetal', { name: 'drill bit cone', position: [0, 0.48, 0], rotation: [PI, 0, 0], ...A });
  // rotating carousel flange near top (clears lattice inner radius 0.45)
  cyl(b, 'hullSecondary', 0.32, 0.32, 0.12, [0, 4.55, 0], { seg: 10, name: 'rotary swivel flange', ...A });
  for (let k = 0; k < 4; k++) {
    const an = (k * PI) / 2;
    lamp(b, 'energyCyan', 0.06, [Math.cos(an) * 0.26, 4.68, Math.sin(an) * 0.26], { name: 'swivel status light', ...A });
  }
  // control hut + ore bin
  box(b, 'hullPrimary', [1.25, 1.05, 0.95], [-1.15, 0.19, -1.42], { r: 0.08, name: 'drill control cabin' });
  box(b, 'hullSecondary', [0.85, 0.08, 0.6], [-1.15, 1.2, -1.42], { r: 0.02, name: 'cabin roof hatch' });
  glow(b, 'energyCyan', [0.65, 0.18, 0.06], [-1.15, 0.72, -0.94], { name: 'cabin console light' });
  box(b, 'hullPrimary', [1.25, 0.85, 0.95], [1.15, 0.19, -1.42], { r: 0.08, name: 'ore hopper bin' });
  b.addPart(new THREE.IcosahedronGeometry(0.35, 0), 'frameGunmetal', { name: 'extracted ore mound', position: [1.15, 1.08, -1.42], scale: [1.2, 0.8, 1] });
  strut(b, 'frameGunmetal', [0.95, 0.55, -1.05], [0.72, 0.32, -0.45], 0.09, { name: 'slurry transfer pipe' });
  cable(b, [-1.15, 1.15, -1.2], [-0.55, 5.12, -0.45], 0.22, 0.035, 'frameGunmetal', { name: 'hoist power cable' });
  lamp(b, 'warningAmber', 0.11, [0.0, 5.95, 0.0], { name: 'derrick beacon light' });
  gridPort(b, 'building.mine', 5.87);
  return b.build();
}

// ---------------------------------------------------------------- Water pump (1x1): spherical tower
export function waterPump() {
  const b = new KitbashBuilder();
  plinth(b, 2, 2);
  box(b, 'hullPrimary', [0.9, 0.76, 0.8], [-0.4, 0.18, 0.4], { r: 0.1, name: 'pump house' });
  glow(b, 'energyCyan', [0.5, 0.1, 0.05], [-0.4, 0.68, 0.8], { name: 'pump status light' });
  for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) strut(b, 'frameGunmetal', [dx * 0.55, 0.18, dz * 0.55 - 0.2], [dx * 0.25, 2.3, dz * 0.25 - 0.2], 0.05, { name: 'tower support post' });
  ring(b, 'frameGunmetal', 0.45, 0.04, [0, 1.2, -0.2], { seg: 12, name: 'tower brace ring' });
  cyl(b, 'frameGunmetal', 0.4, 0.5, 0.22, [0, 2.2, -0.2], { seg: 12, name: 'tank base collar' });
  ball(b, 'hullPrimary', 0.82, [0, 3.1, -0.2], { seg: 14, name: 'water sphere tank' });
  ring(b, 'energyCyan', 0.82, 0.05, [0, 3.1, -0.2], { seg: 16, name: 'water level ring light' });
  ring(b, 'hullSecondary', 0.7, 0.06, [0, 3.6, -0.2], { seg: 14, name: 'tank upper band' });
  cyl(b, 'frameGunmetal', 0.08, 0.1, 0.4, [0, 3.84, -0.2], { seg: 8, name: 'tower finial mast' });
  lamp(b, 'warningAmber', 0.08, [0, 4.29, -0.2], { name: 'tower beacon light' });
  glow(b, 'energyCyan', [0.06, 1.1, 0.06], [0.0, 2.55, 0.58], { name: 'sight glass light' });
  // pipes pump -> tank, intake ground pipe
  strut(b, 'hullSecondary', [-0.2, 0.88, 0.35], [0.18, 2.3, -0.05], 0.085, { name: 'riser pipe' });
  cyl(b, 'frameGunmetal', 0.15, 0.17, 0.42, [0.58, 0.18, 0.4], { seg: 8, name: 'intake wellhead' });
  cyl(b, 'hullSecondary', 0.19, 0.19, 0.08, [0.58, 0.56, 0.4], { seg: 8, name: 'wellhead flange' });
  strut(b, 'hullSecondary', [-0.02, 0.48, 0.4], [0.58, 0.48, 0.4], 0.09, { name: 'intake manifold pipe' });
  cable(b, [-0.55, 0.88, 0.25], [-0.32, 2.32, -0.2], 0.14, 0.03, 'frameGunmetal', { name: 'pump telemetry cable' });
  return b.build();
}

// ---------------------------------------------------------------- Supply depot (2x2)
export function supplyDepot() {
  const b = new KitbashBuilder();
  plinth(b, 4, 4);
  box(b, 'hullPrimary', [3.2, 1.32, 2.4], [-0.1, 0.18, -0.8], { r: 0.12, seg: 1, name: 'depot warehouse hall' });
  // back (-Z) and side (±X) wall buttress columns so all large hall faces carry detail
  for (const x of [-0.9, 0.7]) cyl(b, 'frameGunmetal', 0.08, 0.09, 0.85, [x, 0.32, -2.0], { seg: 6, name: 'rear wall buttress' });
  box(b, 'hullSecondary', [0.9, 0.32, 0.08], [-0.1, 0.85, -2.01], { r: 0.02, name: 'rear access panel' });
  for (const z of [-1.4, -0.2]) {
    cyl(b, 'frameGunmetal', 0.08, 0.09, 0.85, [1.5, 0.32, z], { seg: 6, name: 'right wall buttress' });
    cyl(b, 'frameGunmetal', 0.08, 0.09, 0.85, [-1.7, 0.32, z], { seg: 6, name: 'left wall buttress' });
  }
  // stepped industrial roof + transverse arch ribs standing proud of monitor deck
  box(b, 'hullSecondary', [3.05, 0.32, 2.25], [-0.1, 1.46, -0.8], { r: 0.08, name: 'warehouse roof deck' });
  box(b, 'hullPrimary', [2.4, 0.18, 1.2], [-0.1, 1.72, -0.8], { r: 0.05, name: 'roof monitor deck' });
  for (const x of [-1.1, -0.1, 0.9]) box(b, 'frameGunmetal', [0.12, 0.34, 2.34], [x, 1.6, -0.8], { r: 0.03, seg: 1, name: 'roof arch rib' });
  // big shutter door
  box(b, 'frameGunmetal', [1.9, 1.02, 0.12], [-0.1, 0.18, 0.4], { r: 0.05, name: 'shutter door frame' });
  glow(b, 'warningAmber', [1.5, 0.1, 0.06], [-0.1, 1.05, 0.46], { name: 'shutter header light' });
  for (let k = 0; k < 3; k++) box(b, 'hullPrimary', [1.7, 0.06, 0.06], [-0.1, 0.38 + k * 0.24, 0.46], { r: 0.01, seg: 1, name: 'shutter slat' });
  // cargo crates & containers outside
  box(b, 'hullSecondary', [0.9, 0.72, 0.7], [-1.3, 0.18, 1.2], { r: 0.06, name: 'supply crate A' });
  box(b, 'hullPrimary', [0.7, 0.55, 0.65], [-1.3, 0.88, 1.2], { r: 0.06, name: 'supply crate B' });
  box(b, 'hullPrimary', [0.8, 0.62, 0.8], [-0.45, 0.18, 1.4], { r: 0.06, name: 'supply crate C' });
  box(b, 'frameGunmetal', [1.55, 0.82, 0.8], [1.15, 0.18, 1.3], { r: 0.06, name: 'lower shipping container' });
  glow(b, 'energyCyan', [1.25, 0.06, 0.05], [1.15, 0.78, 1.7], { name: 'container manifest light' });
  box(b, 'hullSecondary', [1.55, 0.7, 0.8], [1.15, 0.98, 1.3], { r: 0.06, name: 'upper shipping container' });
  cyl(b, 'frameGunmetal', 0.22, 0.22, 0.08, [1.35, 1.65, 1.3], { seg: 8, name: 'container hoist latch' });
  box(b, 'frameGunmetal', [0.6, 0.45, 0.06], [1.15, 1.1, 0.89], { r: 0.015, name: 'container rear panel' });
  // gantry crane (silhouette)
  for (const sz of [-1, 1]) strut(b, 'frameGunmetal', [1.7, 0.18, sz * 1.75], [1.7, 2.9, sz * 1.75], 0.07, { name: 'gantry upright post' });
  strut(b, 'frameGunmetal', [1.7, 2.9, -1.78], [1.7, 2.9, 1.78], 0.08, { name: 'gantry bridge beam' });
  box(b, 'hullSecondary', [0.42, 0.3, 0.5], [1.52, 2.68, 1.3], { r: 0.05, name: 'gantry hoist trolley' });
  cable(b, [1.45, 2.72, 1.3], [1.38, 1.7, 1.3], 0.02, 0.025, 'frameGunmetal', { name: 'hoist cable' });
  lamp(b, 'warningAmber', 0.09, [1.7, 3.04, -1.72], { name: 'gantry rear light' });
  lamp(b, 'warningAmber', 0.09, [1.7, 3.04, 1.72], { name: 'gantry front light' });
  cable(b, [-1.55, 0.95, 0.36], [-1.3, 0.82, 0.92], 0.08, 0.04, 'frameGunmetal', { name: 'depot feeder cable' });
  gridPort(b, 'building.supplyDepot', 1.87);
  return b.build();
}
