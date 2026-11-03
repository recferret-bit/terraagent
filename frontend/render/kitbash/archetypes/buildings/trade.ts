// Inter-colony trade & logistics: tradeHub (2x2).
import * as THREE from 'three';
import { KitbashBuilder } from '../../KitbashRegistry';
import { box, cyl, ring, strut, cable, lamp, glow, dish, plinth, spin } from './kit';

// ---------------------------------------------------------------- Inter-Colony Trade Hub (2x2)
export function tradeHub(): THREE.BufferGeometry {
  const b = new KitbashBuilder();
  // Layer A — Foundation plinth (2x2 tiles = 4m x 4m, minY = -0.100)
  plinth(b, 4, 4);

  // Layer B — Core Structural Hull (rear logistics terminal hall + stepped roof + wall detail + shutter door)
  box(b, 'hullPrimary', [3.2, 1.32, 1.85], [-0.15, 0.18, -0.95], { r: 0.1, seg: 1, name: 'logistics terminal hall' });
  for (const x of [-0.95, 0.65]) {
    cyl(b, 'frameGunmetal', 0.08, 0.09, 0.9, [x, 0.3, -1.88], { seg: 6, name: 'rear wall buttress' });
  }
  box(b, 'hullSecondary', [0.85, 0.34, 0.08], [-0.15, 0.82, -1.89], { r: 0.02, seg: 1, name: 'rear manifest hatch' });
  for (const z of [-1.35, -0.55]) {
    cyl(b, 'frameGunmetal', 0.08, 0.09, 0.9, [-1.75, 0.3, z], { seg: 6, name: 'left wall buttress' });
    cyl(b, 'frameGunmetal', 0.08, 0.09, 0.9, [1.45, 0.3, z], { seg: 6, name: 'right wall buttress' });
  }
  // Stepped roof deck + monitor + transverse arch rib
  box(b, 'hullSecondary', [3.0, 0.26, 1.68], [-0.15, 1.46, -0.95], { r: 0.07, seg: 1, name: 'terminal roof deck' });
  box(b, 'hullPrimary', [2.2, 0.18, 1.08], [-0.15, 1.68, -0.95], { r: 0.05, seg: 1, name: 'roof monitor deck' });
  box(b, 'frameGunmetal', [0.16, 0.3, 1.76], [-0.15, 1.6, -0.95], { r: 0.03, seg: 1, name: 'roof arch rib' });

  // Cargo bay shutter door facing the orbital pad + customs status light
  box(b, 'frameGunmetal', [1.45, 0.98, 0.12], [-0.55, 0.18, -0.02], { r: 0.04, seg: 1, name: 'cargo shutter frame' });
  glow(b, 'warningAmber', [1.15, 0.09, 0.06], [-0.55, 1.02, 0.04], { name: 'shutter header light' });
  for (let k = 0; k < 2; k++) {
    box(b, 'hullPrimary', [1.25, 0.07, 0.06], [-0.55, 0.42 + k * 0.28, 0.04], { r: 0.01, seg: 1, name: 'shutter slat' });
  }
  glow(b, 'energyCyan', [0.65, 0.14, 0.06], [0.8, 0.88, -0.02], { name: 'customs status light' });

  // Layer C — Functional Payload (front-left orbital cargo pad + front-right container stack & gantry + cables)
  const px = -0.85, pz = 1.02;
  cyl(b, 'hullPrimary', 0.82, 0.88, 0.16, [px, 0.18, pz], { seg: 8, name: 'orbital pad base' });
  cyl(b, 'hullSecondary', 0.64, 0.68, 0.1, [px, 0.31, pz], { seg: 8, name: 'orbital pad deck' });
  ring(b, 'warningAmber', 0.52, 0.035, [px, 0.42, pz], { seg: 8, tubeSeg: 4, name: 'pad target ring light' });
  // Docked orbital cargo pod on pad center
  cyl(b, 'frameGunmetal', 0.32, 0.36, 0.08, [px, 0.39, pz], { seg: 8, name: 'pad docking collar' });
  cyl(b, 'hullPrimary', 0.22, 0.26, 0.38, [px, 0.45, pz], { seg: 8, name: 'orbital cargo capsule' });
  ring(b, 'energyCyan', 0.24, 0.03, [px, 0.66, pz], { seg: 8, tubeSeg: 4, name: 'capsule beacon ring light' });

  // Stacked orbital cargo containers on front-right dock
  box(b, 'frameGunmetal', [1.3, 0.72, 0.76], [0.95, 0.18, 1.05], { r: 0.06, seg: 1, name: 'lower cargo container' });
  glow(b, 'energyCyan', [0.95, 0.06, 0.05], [0.95, 0.68, 1.43], { name: 'container manifest light' });
  box(b, 'hullSecondary', [1.24, 0.64, 0.72], [0.95, 0.87, 1.05], { r: 0.06, seg: 1, name: 'upper cargo container' });
  cyl(b, 'frameGunmetal', 0.18, 0.2, 0.08, [0.95, 1.48, 1.05], { seg: 8, name: 'container hoist latch' });
  box(b, 'frameGunmetal', [0.55, 0.36, 0.06], [0.95, 1.02, 0.68], { r: 0.015, seg: 1, name: 'container rear panel' });

  // Loading gantry frame + hoist trolley + cables
  for (const z of [-1.65, 1.65]) {
    strut(b, 'frameGunmetal', [1.68, 0.18, z], [1.68, 2.75, z], 0.07, { seg: 6, name: 'gantry upright post' });
    lamp(b, 'warningAmber', 0.085, [1.68, 2.84, z], { seg: 6, hSeg: 4, name: 'gantry beacon light' });
  }
  strut(b, 'frameGunmetal', [1.68, 2.75, -1.7], [1.68, 2.75, 1.7], 0.08, { seg: 6, name: 'gantry bridge beam' });
  strut(b, 'frameGunmetal', [1.72, 2.75, 1.05], [0.85, 2.75, 1.05], 0.065, { seg: 6, name: 'gantry cross beam' });
  box(b, 'hullSecondary', [0.42, 0.26, 0.44], [0.95, 2.56, 1.05], { r: 0.05, seg: 1, name: 'gantry hoist trolley' });
  cable(b, [0.95, 2.6, 1.05], [0.95, 1.52, 1.05], 0.02, 0.025, 'frameGunmetal', { points: 3, seg: 6, name: 'gantry hoist cable' });
  cable(b, [-1.52, 0.85, -0.06], [-1.25, 0.28, 0.36], 0.06, 0.04, 'frameGunmetal', { points: 3, seg: 8, name: 'pad telemetry cable' });

  // Layer D — Emissive Telemetry & Rotating Orbital Uplink Dish (animType = 1)
  const mx = -0.15, mz = -0.95, my = 3.1;
  cyl(b, 'frameGunmetal', 0.22, 0.26, 0.24, [mx, 1.82, mz], { seg: 8, name: 'uplink mast base' });
  cyl(b, 'frameGunmetal', 0.09, 0.12, 0.54, [mx, 2.02, mz], { seg: 8, name: 'uplink mast column' });
  ring(b, 'energyCyan', 0.13, 0.035, [mx, 2.32, mz], { seg: 8, tubeSeg: 4, name: 'mast telemetry ring light' });
  const A = spin(mx, mz);
  cyl(b, 'frameGunmetal', 0.065, 0.065, 0.62, [mx, 2.5, mz], { seg: 6, name: 'uplink rotor neck', ...A });
  dish(b, 0.65, [mx, my, mz], -0.6, { seg: 8, name: 'orbital uplink dish', ...A });
  b.addPart(new THREE.CylinderGeometry(0.025, 0.025, 0.48, 5), 'frameGunmetal', {
    name: 'dish feed boom',
    position: [mx, my + 0.26, mz + 0.16],
    rotation: [0.5, 0, 0],
    ...A,
  });
  b.addPart(new THREE.SphereGeometry(0.07, 6, 5), 'energyCyan', {
    name: 'dish feed horn light',
    position: [mx, my + 0.46, mz + 0.28],
    ...A,
  });

  return b.build();
}
