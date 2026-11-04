import { gridPort } from './gridPorts';
// Power: pylon, capacitor, solar, wind, coal generator.
import * as THREE from 'three';
import { KitbashBuilder } from '../../KitbashRegistry';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { box, cyl, ball, ring, strut, cable, lamp, glow, plinth, lattice, type V3, spin } from './kit';

const PI = Math.PI;

// ---------------------------------------------------------------- Pylon (1x1)
/** Crossbeams `[height, half-width]`; the grid cables hang from the `insulator cap` under each end (`gridCables`). */
export const PYLON_CROSSBEAMS: ReadonlyArray<readonly [number, number]> = [[4.2, 0.9], [5.0, 0.6]];
/** Drop from a crossbeam's height to the centre of its insulator cap. */
export const PYLON_INSULATOR_DROP = 0.45;

export function pylon() {
  const b = new KitbashBuilder();
  plinth(b, 2, 2);
  box(b, 'hullPrimary', [1.1, 0.55, 1.1], [0, 0.18, 0], { r: 0.1, name: 'pylon base' });
  box(b, 'hullPrimary', [0.76, 0.55, 0.76], [0, 0.68, 0], { r: 0.08, name: 'pylon core' });
  lattice(b, 0.4, 0.12, 0.65, 5.2, 4, 0.055);
  for (const s of [-1, 1]) {
    box(b, 'hullPrimary', [0.36, 0.48, 0.36], [s * 0.68, 0.18, s * 0.58], { r: 0.05, name: 'feeder transformer' });
  }
  // crossbeams w/ insulators
  for (const [y, w] of PYLON_CROSSBEAMS) {
    box(b, 'frameGunmetal', [w * 2 + 0.1, 0.12, 0.42], [0, y, 0], { r: 0.03, name: 'pylon crossbeam' });
    for (const s of [-1, 1]) {
      cyl(b, 'frameGunmetal', 0.035, 0.035, 0.48, [s * w, y - 0.44, 0], { seg: 6, name: 'insulator rod' });
      for (let k = 0; k < 3; k++) cyl(b, 'hullSecondary', 0.1, 0.1, 0.05, [s * w, y - 0.1 - k * 0.1, 0], { seg: 8, name: 'insulator disc' });
      // Non-emissive end cap (the grid core is the pylon's only light): the cable anchor the power lines hang from.
      b.addPart(new THREE.SphereGeometry(0.09, 6, 5), 'hullSecondary', { name: 'insulator cap', position: [s * w, y - PYLON_INSULATOR_DROP, 0] });
    }
  }
  for (const s of [-1, 1]) {
    cable(b, [s * 0.6, 4.48, 0], [s * 0.82, 4.28, 0], 0.04, 0.022, 'frameGunmetal', { name: 'jumper cable' });
    cable(b, [s * 0.9, 3.75, 0], [s * 0.68, 0.62, s * 0.58], 0.22, 0.025, 'frameGunmetal', { name: 'feeder cable' });
  }
  cyl(b, 'frameGunmetal', 0.18, 0.18, 0.12, [0, 5.14, 0], { seg: 8, name: 'pylon crown' });
  cyl(b, 'frameGunmetal', 0.035, 0.045, 0.86, [0, 5.22, 0], { seg: 6, name: 'finial mast' });
  // The pylon's single light source (its projector entry in `lighting/archetypeLights.ts` sits here).
  ball(b, 'energyCyan', 0.2, [0, 5.55, 0], { emissiveIntensity: 4.2, name: 'grid core light' });
  b.addPart(new THREE.SphereGeometry(0.06, 6, 5), 'frameGunmetal', { name: 'finial cap', position: [0, 6.08, 0] });
  return b.build();
}

// ---------------------------------------------------------------- Capacitor (1x1)
export function capacitor() {
  const b = new KitbashBuilder();
  plinth(b, 2, 2);
  box(b, 'hullPrimary', [1.7, 0.52, 1.7], [0, 0.18, 0], { r: 0.12, name: 'capacitor deck' });
  const cells: V3[] = [[-0.45, 0, -0.35], [0.45, 0, -0.35], [0, 0, 0.45]];
  cells.forEach(([x, , z], i) => {
    const h = 1.8 + i * 0.35;
    cyl(b, 'hullPrimary', 0.36, 0.36, h, [x, 0.68, z], { seg: 12, name: `capacitor cell ${i + 1}` });
    for (let k = 0; k < 3; k++) ring(b, 'energyCyan', 0.375, 0.035, [x, 1.1 + k * (h / 3.2), z], { seg: 12, name: 'charge ring light' });
    cyl(b, 'frameGunmetal', 0.38, 0.38, 0.12, [x, 0.66 + h, z], { seg: 12, name: 'cell cap' });
    cyl(b, 'hullSecondary', 0.1, 0.1, 0.38, [x, 0.76 + h, z], { seg: 8, name: 'cell terminal' });
    ball(b, 'energyCyan', 0.11, [x, 1.2 + h, z], { emissiveIntensity: 4, name: 'terminal sphere light' });
  });
  // bus cables between terminal posts (arched above cell caps)
  cable(b, [-0.45, 2.86, -0.35], [0.45, 3.21, -0.35], -0.06, 0.035, 'frameGunmetal', { name: 'bus cable AB' });
  cable(b, [0.45, 3.21, -0.35], [0, 3.56, 0.45], -0.06, 0.035, 'frameGunmetal', { name: 'bus cable BC' });
  cable(b, [0, 3.56, 0.45], [-0.45, 2.86, -0.35], -0.06, 0.035, 'frameGunmetal', { name: 'bus cable CA' });
  glow(b, 'energyCyan', [1.0, 0.1, 0.05], [0, 0.35, 0.85], { name: 'deck status light' });
  box(b, 'hullSecondary', [0.35, 0.34, 0.3], [0.62, 0.68, 0.62], { r: 0.05, name: 'relay box' });
  cable(b, [0.48, 0.92, 0.62], [0.28, 0.92, 0.55], 0.04, 0.035, 'frameGunmetal', { name: 'relay cable' });
  return b.build();
}
// ---------------------------------------------------------------- Solar array (2x2)
export function solar() {
  const b = new KitbashBuilder();
  plinth(b, 4, 4);
  box(b, 'hullPrimary', [1.2, 0.82, 1.0], [0, 0.18, 1.35], { r: 0.1, name: 'inverter housing' });
  box(b, 'hullSecondary', [0.7, 0.06, 0.5], [0, 0.98, 1.35], { r: 0.02, name: 'inverter hatch' });
  glow(b, 'energyCyan', [0.6, 0.08, 0.04], [0, 0.75, 1.86], { name: 'inverter status light' });
  lamp(b, 'energyCyan', 0.08, [0.45, 0.92, 1.86], { name: 'inverter beacon light' });
  const tilt = 0.5;
  const eul = new THREE.Euler(tilt, 0, 0);
  for (const sx of [-1, 1]) {
    const org = new THREE.Vector3(sx * 1.0, 1.7, -0.15);
    const P = (lx: number, ly: number, lz: number): V3 => { const v = new THREE.Vector3(lx, ly, lz).applyEuler(eul).add(org); return [v.x, v.y, v.z]; };
    const wid = 1.7, len = 2.7;
    b.addPart(new RoundedBoxGeometry(wid, 0.1, len, 1, 0.04), 'frameGunmetal', { name: 'solar wing frame', position: P(0, 0, 0), rotation: [tilt, 0, 0] });
    // hex photovoltaic cells (mid blue)
    const hr = 0.24, dx = hr * 1.5 * 1.08, dz = hr * 1.732 * 1.08;
    for (let i = 0; (i * dx) < wid - 0.3; i++) for (let j = 0; (j * dz) < len - 0.3; j++) {
      const lx = -wid / 2 + 0.24 + i * dx, lz = -len / 2 + 0.26 + j * dz + (i % 2) * dz * 0.5;
      if (lz > len / 2 - 0.18) continue;
      b.addPart(new THREE.CylinderGeometry(hr * 0.92, hr * 0.92, 0.05, 6), 'solarCell', { name: 'solar cell', position: P(lx, 0.065, lz), rotation: [tilt, PI / 6, 0] });
    }
    // emissive edge strip + rim (hullSecondary)
    b.addPart(new RoundedBoxGeometry(wid + 0.06, 0.05, 0.1, 1, 0.015), 'hullSecondary', { name: 'wing header trim', position: P(0, 0.05, -len / 2), rotation: [tilt, 0, 0] });
    b.addPart(new RoundedBoxGeometry(0.05, 0.03, len, 1, 0.01), 'energyCyan', { name: 'wing edge light', position: P(sx * -wid / 2, 0.05, 0), rotation: [tilt, 0, 0] });
    // support legs
    const hi = P(0, 0, -len / 2 + 0.3), lo = P(0, 0, len / 2 - 0.3);
    strut(b, 'frameGunmetal', [sx * 1.05, 0.18, hi[2]], hi, 0.07, { name: 'rear support strut' });
    strut(b, 'frameGunmetal', [sx * 1.05 + sx * 0.2, 0.18, lo[2] + 0.3], lo, 0.06, { name: 'front support strut' });
    cable(b, [sx * 0.55, 0.75, 1.35], [sx * 1.0, lo[1], lo[2]], 0.16, 0.035, 'frameGunmetal', { name: 'wing power cable' });
  }
  // small sun-tracker mast + vane (silhouette breaker)
  strut(b, 'frameGunmetal', [0, 0.18, -1.65], [0.15, 3.62, -1.7], 0.05, { name: 'tracker mast' });
  box(b, 'hullSecondary', [0.5, 0.06, 0.3], [0.15, 3.58, -1.7], { r: 0.02, seg: 1, name: 'tracker vane', rotation: [0, 0.4, 0] } as any);
  lamp(b, 'warningAmber', 0.09, [0.15, 3.69, -1.7], { name: 'tracker beacon light' });
  return b.build();
}

// ---------------------------------------------------------------- Wind (2x2): vertical-axis rotor
export function wind() {
  const b = new KitbashBuilder();
  plinth(b, 4, 4);
  box(b, 'hullPrimary', [1.5, 0.82, 1.5], [0, 0.18, 0], { r: 0.15, name: 'turbine base' });
  glow(b, 'energyCyan', [0.8, 0.08, 0.05], [0, 0.75, 0.74], { name: 'turbine status light' });
  cyl(b, 'frameGunmetal', 0.2, 0.32, 5.45, [0, 0.96, 0], { seg: 10, name: 'turbine mast' });
  cyl(b, 'hullSecondary', 0.35, 0.35, 0.25, [0, 0.96, 0], { seg: 10, name: 'mast base collar' });
  const R = 1.5;
  // static top cap + aviation lamp
  cyl(b, 'frameGunmetal', 0.16, 0.2, 0.28, [0, 6.38, 0], { seg: 10, name: 'mast top cap' });
  lamp(b, 'dangerCrimson', 0.1, [0, 6.72, 0], { name: 'aviation light' });
  // rotor (rotates about Y at 0,0)
  const A = spin(0, 0);
  for (const y of [2.0, 5.4]) {
    cyl(b, 'hullSecondary', 0.3, 0.3, 0.2, [0, y, 0], { seg: 10, name: 'rotor hub ring', ...A });
    for (let i = 0; i < 3; i++) {
      const an = (i * 2 * PI) / 3;
      strut(b, 'frameGunmetal', [0, y + 0.1, 0], [Math.cos(an) * R, y + 0.1, Math.sin(an) * R], 0.05, { name: 'rotor spoke', ...A });
    }
  }
  for (let i = 0; i < 3; i++) {
    const an = (i * 2 * PI) / 3;
    const c = Math.cos(an), s = Math.sin(an);
    b.addPart(new RoundedBoxGeometry(0.12, 3.8, 0.48, 1, 0.04), 'hullPrimary', {
      name: 'rotor blade', position: [c * R, 3.8, s * R], rotation: [0, -an, 0], ...A,
    });
    b.addPart(new RoundedBoxGeometry(0.05, 0.95, 0.52, 1, 0.015), 'hullSecondary', {
      name: 'blade accent cuff', position: [c * (R + 0.05), 3.8, s * (R + 0.05)], rotation: [0, -an, 0], ...A,
    });
    b.addPart(new THREE.BoxGeometry(0.14, 0.14, 0.2), 'energyCyan', {
      name: 'blade tip light', position: [c * R, 5.74, s * R], rotation: [0, -an, 0], ...A,
    });
  }
  box(b, 'hullSecondary', [0.5, 0.55, 0.5], [1.25, 0.18, 0.95], { r: 0.06, name: 'wind transformer' });
  cable(b, [0.7, 0.78, 0.45], [1.05, 0.65, 0.78], 0.1, 0.045, 'frameGunmetal', { name: 'turbine feeder cable' });
  return b.build();
}

// ---------------------------------------------------------------- Coal / Oil generator (2x2)
export function coalGen() {
  const b = new KitbashBuilder();
  plinth(b, 4, 4);
  box(b, 'hullPrimary', [2.6, 1.52, 1.9], [-0.3, 0.18, -0.3], { r: 0.15, name: 'furnace hall' });
  box(b, 'frameGunmetal', [2.7, 0.16, 2.0], [-0.3, 0.9, -0.3], { r: 0.04, name: 'hall waist band' });
  // boiler drum + left end hatch
  b.addPart(new THREE.CylinderGeometry(0.75, 0.75, 2.2, 12), 'hullSecondary', { name: 'boiler drum', position: [-0.3, 2.3, -0.3], rotation: [0, 0, PI / 2] });
  b.addPart(new THREE.CylinderGeometry(0.42, 0.42, 0.08, 10), 'frameGunmetal', { name: 'boiler end hatch', position: [-1.41, 2.3, -0.3], rotation: [0, 0, PI / 2] });
  lamp(b, 'warningAmber', 0.1, [-1.46, 2.3, -0.3], { name: 'boiler pressure light' });
  for (const x of [-1.0, -0.3, 0.4]) ring(b, 'frameGunmetal', 0.77, 0.05, [x, 2.3, -0.3], { rotation: [0, PI / 2, 0], name: 'boiler band' });
  // stacks
  [[-1.0, 4.4, 0.26], [-0.3, 5.4, 0.22], [0.4, 4.8, 0.26]].forEach(([x, top, r], i) => {
    cyl(b, 'frameGunmetal', r * 0.8, r, top - 2.7, [x, 2.7, -0.3], { seg: 10, name: `exhaust stack ${i + 1}` });
    ring(b, 'warningAmber', r * 0.85, 0.035, [x, top - 0.25, -0.3], { seg: 10, name: 'stack warning ring light' });
    ring(b, 'hullPrimary', r * 0.9, 0.04, [x, top - 0.6, -0.3], { seg: 10, name: 'stack collar' });
    cyl(b, 'warningAmber', r * 0.65, r * 0.65, 0.06, [x, top - 0.03, -0.3], { seg: 10, emissiveIntensity: 3.4, name: 'stack flue glow light' });
  });
  // furnace door glow
  box(b, 'frameGunmetal', [1.0, 0.82, 0.14], [-0.3, 0.18, 0.62], { r: 0.05, name: 'furnace door frame' });
  glow(b, 'warningAmber', [0.7, 0.45, 0.08], [-0.3, 0.42, 0.69], { emissiveIntensity: 3.6, name: 'furnace ember light' });
  // coal hopper + conveyor + pile
  cyl(b, 'hullPrimary', 0.68, 0.24, 0.82, [1.35, 1.35, -0.6], { seg: 8, name: 'coal hopper' });
  ring(b, 'hullSecondary', 0.68, 0.05, [1.35, 2.15, -0.6], { seg: 8, name: 'hopper rim' });
  cyl(b, 'frameGunmetal', 0.22, 0.26, 0.95, [1.35, 0.45, -0.6], { seg: 8, name: 'hopper chute' });
  for (const sx of [-1, 1]) strut(b, 'frameGunmetal', [1.35 + sx * 0.35, 0.18, -0.6], [1.35 + sx * 0.35, 1.75, -0.6], 0.06, { name: 'hopper post' });
  box(b, 'frameGunmetal', [0.5, 0.28, 1.85], [1.35, 0.18, 0.28], { r: 0.05, name: 'coal conveyor' });
  glow(b, 'energyCyan', [0.12, 0.04, 1.7], [1.35, 0.44, 0.28], { name: 'conveyor guide light' });
  for (const [x, z, s] of [[1.35, 1.48, 0.38], [1.1, 1.38, 0.26], [1.62, 1.42, 0.26]] as V3[]) {
    b.addPart(new THREE.IcosahedronGeometry(s, 0), 'frameGunmetal', { name: 'coal mound', position: [x, 0.22 + s * 0.4, z], scale: [1, 0.7, 1] });
  }
  // steam pipe + junction box + sagging cable
  strut(b, 'frameGunmetal', [0.4, 2.55, -0.3], [1.35, 2.05, -0.6], 0.07, { name: 'steam transfer pipe' });
  box(b, 'hullSecondary', [0.42, 0.52, 0.42], [-1.52, 0.19, 1.15], { r: 0.05, name: 'switchgear box' });
  cable(b, [-1.52, 0.82, 0.55], [-1.52, 0.66, 0.98], 0.08, 0.045, 'frameGunmetal', { name: 'generator power cable' });
  gridPort(b, 'building.coalGen', 1.67);
  return b.build();
}
