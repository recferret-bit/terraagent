// Power: pylon, capacitor, solar, wind, coal generator.
import * as THREE from 'three';
import { KitbashBuilder } from '../../KitbashRegistry';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { box, cyl, ball, ring, strut, cable, lamp, glow, plinth, lattice, type V3, spin } from './kit';

const PI = Math.PI;

// ---------------------------------------------------------------- Pylon (1x1)
export function pylon() {
  const b = new KitbashBuilder();
  plinth(b, 2, 2);
  box(b, 'hullPrimary', [0.9, 0.5, 0.9], [0, 0.2, 0], { r: 0.1 });
  lattice(b, 0.4, 0.1, 0.65, 5.2, 4, 0.06);
  // crossarms w/ insulators
  for (const [y, w] of [[4.2, 0.9], [5.0, 0.6]] as [number, number][]) {
    box(b, 'frameGunmetal', [w * 2, 0.1, 0.1], [0, y, 0], { r: 0.03 });
    for (const s of [-1, 1]) {
      for (let k = 0; k < 3; k++) cyl(b, 'hullSecondary', 0.1, 0.1, 0.05, [s * w, y - 0.1 - k * 0.1, 0], { seg: 8 });
      lamp(b, 'energyCyan', 0.09, [s * w, y - 0.45, 0]);
      cable(b, [s * w, y - 0.45, 0], [s * (w + 0.1), 0.5, s * 0.5], 0.9, 0.025);
    }
  }
  ball(b, 'energyCyan', 0.22, [0, 5.55, 0], { emissiveIntensity: 4.2 });
  cyl(b, 'frameGunmetal', 0.03, 0.04, 0.5, [0, 5.3, 0], { seg: 6 });
  lamp(b, 'dangerCrimson', 0.08, [0, 6.0, 0]);
  strut(b, 'frameGunmetal', [0, 5.8, 0], [0, 6.05, 0], 0.025);
  return b.build();
}

// ---------------------------------------------------------------- Capacitor (1x1)
export function capacitor() {
  const b = new KitbashBuilder();
  plinth(b, 2, 2);
  box(b, 'hullPrimary', [1.7, 0.5, 1.7], [0, 0.2, 0], { r: 0.12, seg: 3 });
  const cells: V3[] = [[-0.45, 0, -0.35], [0.45, 0, -0.35], [0, 0, 0.45]];
  cells.forEach(([x, , z], i) => {
    const h = 1.8 + i * 0.35;
    cyl(b, 'hullPrimary', 0.36, 0.36, h, [x, 0.7, z], { seg: 18 });
    for (let k = 0; k < 3; k++) ring(b, 'energyCyan', 0.375, 0.035, [x, 1.1 + k * (h / 3.2), z], { seg: 20 });
    cyl(b, 'frameGunmetal', 0.4, 0.4, 0.12, [x, 0.7 + h, z], { seg: 18 });
    cyl(b, 'hullSecondary', 0.1, 0.1, 0.25, [x, 0.82 + h, z], { seg: 8 });
    ball(b, 'energyCyan', 0.12, [x, 1.12 + h, z], { emissiveIntensity: 4 });
  });
  // bus bar between cell tops + sagging cables
  cable(b, [-0.45, 2.9, -0.35], [0.45, 2.9, -0.35], 0.25, 0.04);
  cable(b, [0.45, 2.9, -0.35], [0, 3.25, 0.45], 0.3, 0.04);
  cable(b, [0, 3.25, 0.45], [-0.45, 2.9, -0.35], 0.3, 0.04);
  glow(b, 'energyCyan', [1.0, 0.1, 0.05], [0, 0.35, 0.87]);
  box(b, 'hullSecondary', [0.35, 0.35, 0.3], [0.7, 0.2, 0.8], { r: 0.05 });
  cable(b, [0.7, 0.5, 0.95], [1.3, 0.3, 1.4], 0.2, 0.05);
  return b.build();
}
// ---------------------------------------------------------------- Solar array (2x2)
export function solar() {
  const b = new KitbashBuilder();
  plinth(b, 4, 4);
  box(b, 'hullPrimary', [1.2, 0.8, 1.0], [0, 0.2, 1.45], { r: 0.1 });
  glow(b, 'energyCyan', [0.6, 0.08, 0.04], [0, 0.75, 1.97]);
  lamp(b, 'energyCyan', 0.08, [0.45, 0.92, 1.97]);
  const tilt = 0.5;
  const eul = new THREE.Euler(tilt, 0, 0);
  for (const sx of [-1, 1]) {
    const org = new THREE.Vector3(sx * 1.0, 1.7, -0.15);
    const P = (lx: number, ly: number, lz: number): V3 => { const v = new THREE.Vector3(lx, ly, lz).applyEuler(eul).add(org); return [v.x, v.y, v.z]; };
    const wid = 1.7, len = 2.7;
    b.addPart(new RoundedBoxGeometry(wid, 0.1, len, 2, 0.04), 'frameGunmetal', { position: P(0, 0, 0), rotation: [tilt, 0, 0] });
    // hex photovoltaic cells (dark blue)
    const hr = 0.2, dx = hr * 1.5 * 1.06, dz = hr * 1.732 * 1.06;
    for (let i = 0; (i * dx) < wid - 0.3; i++) for (let j = 0; (j * dz) < len - 0.3; j++) {
      const lx = -wid / 2 + 0.2 + i * dx, lz = -len / 2 + 0.22 + j * dz + (i % 2) * dz * 0.5;
      if (lz > len / 2 - 0.15) continue;
      b.addPart(new THREE.CylinderGeometry(hr * 0.93, hr * 0.93, 0.05, 6), 'solarCell', { position: P(lx, 0.07, lz), rotation: [tilt, PI / 6, 0] });
    }
    // emissive edge strip + rim (hullSecondary)
    b.addPart(new RoundedBoxGeometry(wid + 0.06, 0.05, 0.1, 1, 0.015), 'hullSecondary', { position: P(0, 0.05, -len / 2), rotation: [tilt, 0, 0] });
    b.addPart(new RoundedBoxGeometry(0.05, 0.03, len, 1, 0.01), 'energyCyan', { position: P(sx * -wid / 2, 0.05, 0), rotation: [tilt, 0, 0] });
    // support legs
    const hi = P(0, 0, -len / 2 + 0.3), lo = P(0, 0, len / 2 - 0.3);
    strut(b, 'frameGunmetal', [sx * 1.05, 0.2, hi[2]], hi, 0.07);
    strut(b, 'frameGunmetal', [sx * 1.05 + sx * 0.2, 0.2, lo[2] + 0.3], lo, 0.06);
    cable(b, [sx * 0.5, 0.7, 1.5], [sx * 1.0, lo[1] - 0.1, lo[2]], 0.3, 0.04);
  }
  // small sun-tracker mast + vane (silhouette breaker)
  strut(b, 'frameGunmetal', [0, 0.2, -1.7], [0.15, 3.6, -1.75], 0.05);
  box(b, 'hullSecondary', [0.5, 0.05, 0.3], [0.15, 3.6, -1.75], { r: 0.02, seg: 1, rotation: [0, 0.4, 0] } as any);
  lamp(b, 'warningAmber', 0.09, [0.15, 3.75, -1.75]);
  return b.build();
}

// ---------------------------------------------------------------- Wind (2x2): vertical-axis rotor
export function wind() {
  const b = new KitbashBuilder();
  plinth(b, 4, 4);
  box(b, 'hullPrimary', [1.5, 0.8, 1.5], [0, 0.2, 0], { r: 0.15, seg: 3 });
  glow(b, 'energyCyan', [0.8, 0.08, 0.05], [0, 0.75, 0.76]);
  cyl(b, 'frameGunmetal', 0.2, 0.32, 5.4, [0, 1.0, 0], { seg: 10 });
  cyl(b, 'hullSecondary', 0.34, 0.34, 0.25, [0, 1.0, 0], { seg: 10 });
  const R = 1.55;
  // static top cap + aviation lamp
  cyl(b, 'frameGunmetal', 0.16, 0.2, 0.25, [0, 6.4, 0], { seg: 10 });
  lamp(b, 'dangerCrimson', 0.1, [0, 6.75, 0]);
  // rotor (rotates about Y at 0,0)
  const A = spin(0, 0);
  for (const y of [2.0, 5.6]) {
    cyl(b, 'hullSecondary', 0.3, 0.3, 0.2, [0, y, 0], { seg: 10, ...A });
    for (let i = 0; i < 3; i++) {
      const an = (i * 2 * PI) / 3;
      strut(b, 'frameGunmetal', [0, y + 0.1, 0], [Math.cos(an) * R, y + 0.1, Math.sin(an) * R], 0.05, A);
    }
  }
  for (let i = 0; i < 3; i++) {
    const an = (i * 2 * PI) / 3;
    const c = Math.cos(an), s = Math.sin(an);
    // helical-ish blade: 3 stacked twisted slabs
    for (let k = 0; k < 3; k++) {
      const t = k / 2, y = 2.2 + k * 1.15;
      const a2 = an + (t - 0.5) * 0.5;
      b.addPart(new RoundedBoxGeometry(0.1, 1.25, 0.55, 2, 0.04), k === 1 ? 'hullSecondary' : 'hullPrimary', {
        position: [Math.cos(a2) * R, y + 0.6, Math.sin(a2) * R], rotation: [0, -a2, 0.0], ...A,
      });
    }
    glow(b, 'energyCyan', [0.06, 0.12, 0.06], [c * R, 5.25, s * R], { ...A });
  }
  cable(b, [0.3, 1.0, 0.2], [1.4, 0.3, 1.2], 0.4, 0.06);
  return b.build();
}

// ---------------------------------------------------------------- Coal / Oil generator (2x2)
export function coalGen() {
  const b = new KitbashBuilder();
  plinth(b, 4, 4);
  box(b, 'hullPrimary', [2.6, 1.5, 1.9], [-0.3, 0.2, -0.3], { r: 0.15, seg: 3 });
  box(b, 'frameGunmetal', [2.7, 0.16, 2.0], [-0.3, 0.9, -0.3], { r: 0.04 });
  // boiler drum
  b.addPart(new THREE.CylinderGeometry(0.75, 0.75, 2.2, 20), 'hullSecondary', { position: [-0.3, 2.3, -0.3], rotation: [0, 0, PI / 2] });
  for (const x of [-1.0, -0.3, 0.4]) ring(b, 'frameGunmetal', 0.77, 0.05, [x, 2.3, -0.3], { rotation: [0, PI / 2, 0] });
  // stacks
  [[-1.0, 4.4, 0.26], [-0.3, 5.4, 0.22], [0.4, 4.8, 0.26]].forEach(([x, top, r]) => {
    cyl(b, 'frameGunmetal', r * 0.8, r, top - 2.7, [x, 2.7, -0.3], { seg: 14 });
    ring(b, 'warningAmber', r * 0.85, 0.035, [x, top - 0.25, -0.3], { seg: 14 });
    ring(b, 'hullPrimary', r * 0.9, 0.04, [x, top - 0.6, -0.3], { seg: 14 });
    cyl(b, 'warningAmber', r * 0.65, r * 0.65, 0.04, [x, top - 0.02, -0.3], { seg: 14, emissiveIntensity: 3.4 });
  });
  // furnace door glow
  box(b, 'frameGunmetal', [1.0, 0.8, 0.12], [-0.3, 0.3, 0.7], { r: 0.05 });
  glow(b, 'warningAmber', [0.7, 0.45, 0.05], [-0.3, 0.45, 0.78], { emissiveIntensity: 3.6 });
  // coal hopper + conveyor + pile
  cyl(b, 'hullPrimary', 0.7, 0.2, 0.8, [1.5, 1.4, -0.6], { seg: 4, rotation: [0, PI / 4, 0] });
  for (const sx of [-1, 1]) strut(b, 'frameGunmetal', [1.5 + sx * 0.5, 0.2, -0.6 + sx * 0.4], [1.5 + sx * 0.5, 1.5, -0.6 + sx * 0.4], 0.06);
  box(b, 'frameGunmetal', [0.5, 0.15, 2.4], [1.5, 0.35, 0.65], { r: 0.05, rotation: [0.0, 0, 0] } as any);
  glow(b, 'energyCyan', [0.12, 0.04, 2.3], [1.5, 0.5, 0.65]);
  for (const [x, z, s] of [[1.5, 1.7, 0.45], [1.2, 1.5, 0.3], [1.85, 1.55, 0.3]] as V3[]) b.addPart(new THREE.IcosahedronGeometry(s, 0), 'frameGunmetal', { position: [x, 0.2 + s * 0.6, z], scale: [1, 0.7, 1] });
  // steam pipe + sagging cable
  strut(b, 'frameGunmetal', [0.4, 2.7, -0.3], [1.5, 2.7, -0.6], 0.07);
  cable(b, [-1.5, 2.0, -0.5], [-1.6, 0.3, 1.2], 0.35, 0.05);
  return b.build();
}
