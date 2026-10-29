import * as THREE from 'three';
import { KitbashBuilder } from '../KitbashRegistry';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ArchetypeCatalog } from '../catalog';
import { box, cyl, ball, capsule, ring, strut, cable, lamp, glow, dish, plinth, lattice, type V3 } from './buildings/kit';

/** Footprints are in 2 m tiles (1x1 = 2m x 2m). Front of every building faces +Z. */
const PI = Math.PI;
const spin = (x: number, z: number) => ({ animType: 1 as const, animPivot: [x, 0, z] as V3 });

// ---------------------------------------------------------------- Command Hub (3x3)
function commandHub() {
  const b = new KitbashBuilder();
  plinth(b, 6, 6);
  // main hull + upper drum + dome
  box(b, 'hullPrimary', [4.4, 1.3, 4.2], [-0.2, 0.2, -0.2], { r: 0.2, seg: 3 });
  box(b, 'frameGunmetal', [4.5, 0.18, 4.3], [-0.2, 1.1, -0.2], { r: 0.05 }); // waist band
  box(b, 'hullPrimary', [3.8, 0.6, 3.6], [-0.2, 1.4, -0.2], { r: 0.18, seg: 3 });
  cyl(b, 'hullPrimary', 1.5, 1.7, 0.7, [-0.2, 2.0, -0.2], { seg: 24 });
  ring(b, 'energyCyan', 1.55, 0.06, [-0.2, 2.72, -0.2], { seg: 32 });
  b.addPart(new THREE.SphereGeometry(1.35, 24, 12, 0, PI * 2, 0, PI / 2), 'glassVisor', { position: [-0.2, 2.7, -0.2] });
  // dome ribs
  for (let i = 0; i < 4; i++) b.addPart(new THREE.TorusGeometry(1.37, 0.035, 6, 20, PI), 'frameGunmetal', { position: [-0.2, 2.7, -0.2], rotation: [0, (i * PI) / 4, 0] });
  // 4 corner columns
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    cyl(b, 'frameGunmetal', 0.2, 0.26, 1.5, [-0.2 + sx * 2.2, 0.2, -0.2 + sz * 2.1], { seg: 8 });
    lamp(b, 'warningAmber', 0.1, [-0.2 + sx * 2.2, 1.75, -0.2 + sz * 2.1]);
  }
  // front entry
  box(b, 'frameGunmetal', [1.6, 1.0, 0.3], [-0.2, 0.2, 1.95], { r: 0.08 });
  glow(b, 'energyCyan', [1.2, 0.15, 0.06], [-0.2, 0.75, 2.12], { emissiveIntensity: 3.8 });
  glow(b, 'energyCyan', [0.12, 0.7, 0.06], [-0.9, 0.3, 2.12]);
  glow(b, 'energyCyan', [0.12, 0.7, 0.06], [0.5, 0.3, 2.12]);
  // landing pad wing (+x, -z... right-back)
  box(b, 'frameGunmetal', [2.2, 0.45, 2.2], [2.45, 0.0, 1.8], { r: 0.1, seg: 3 });
  cyl(b, 'hullPrimary', 1.0, 1.0, 0.12, [2.45, 0.45, 1.8], { seg: 28 });
  ring(b, 'warningAmber', 0.85, 0.045, [2.45, 0.6, 1.8], { seg: 32 });
  box(b, 'warningAmber', [0.12, 0.03, 0.8], [2.2, 0.57, 1.8], { r: 0.01, seg: 1 });
  box(b, 'warningAmber', [0.12, 0.03, 0.8], [2.7, 0.57, 1.8], { r: 0.01, seg: 1 });
  box(b, 'warningAmber', [0.5, 0.03, 0.1], [2.45, 0.57, 1.8], { r: 0.01, seg: 1 });
  // storage tanks (left-back)
  for (const k of [0, 1]) capsule(b, 'hullSecondary', 0.5, 1.1, [-2.5 + k * 1.1, 0.2, -2.0], { seg: 12 });
  box(b, 'frameGunmetal', [2.2, 0.12, 0.3], [-1.95, 1.05, -2.0], { r: 0.04 });
  // main tall antenna (angled) + guy cables
  const base: V3 = [1.0, 2.0, -1.4];
  strut(b, 'frameGunmetal', [1.0, 1.9, -1.4], [1.35, 6.4, -1.75], 0.08);
  strut(b, 'frameGunmetal', [1.2, 4.0, -1.55], [1.2, 4.0, -1.55], 0.0001);
  box(b, 'hullSecondary', [0.4, 0.5, 0.4], [0.85, 1.9, -1.6], { r: 0.08 });
  for (const h of [3.4, 4.6]) ring(b, 'hullSecondary', 0.24, 0.035, [1.0 + (h - 2) * 0.08, h, -1.4 - (h - 2) * 0.08], { seg: 10 });
  lamp(b, 'dangerCrimson', 0.13, [1.35, 6.55, -1.75], { emissiveIntensity: 4.2 });
  cable(b, [1.3, 6.0, -1.7], [2.3, 1.9, -2.5], 0.5, 0.025);
  cable(b, [1.3, 5.5, -1.7], [-0.4, 2.0, -2.3], 0.4, 0.025);
  // rotating radar tower (left-front top)
  cyl(b, 'frameGunmetal', 0.12, 0.2, 1.2, [-1.4, 2.35, 0.7], { seg: 8 });
  box(b, 'hullSecondary', [0.9, 0.2, 0.9], [-1.4, 2.3, 0.7], { r: 0.06 });
  dish(b, 0.85, [-1.4, 3.75, 0.7], -0.55, spin(-1.4, 0.7));
  cyl(b, 'frameGunmetal', 0.05, 0.05, 0.5, [-1.4, 3.65, 0.7], { seg: 6, ...spin(-1.4, 0.7) });
  box(b, 'energyCyan', [0.1, 0.1, 0.1], [-1.4 - 0.18, 4.0, 0.7 + 0.28], { seg: 1, r: 0.01, ...spin(-1.4, 0.7) });
  // power cable hub -> pad
  cable(b, [1.6, 0.5, 0.4], [2.45, 0.5, 1.2], 0.25, 0.05);
  return b.build();
}

// ---------------------------------------------------------------- Claim Beacon (1x1)
function claimBeacon() {
  const b = new KitbashBuilder();
  plinth(b, 2, 2);
  cyl(b, 'hullPrimary', 0.5, 0.75, 0.5, [0, 0.2, 0], { seg: 8 });
  ring(b, 'hullSecondary', 0.62, 0.05, [0, 0.62, 0], { seg: 8 });
  cyl(b, 'frameGunmetal', 0.22, 0.34, 1.6, [0, 0.7, 0], { seg: 8 });
  for (const a of [0, 1, 2]) {
    const an = a * 2.094 + 0.4;
    strut(b, 'hullSecondary', [Math.cos(an) * 0.55, 0.65, Math.sin(an) * 0.55], [Math.cos(an) * 0.18, 2.1, Math.sin(an) * 0.18], 0.06);
  }
  b.addPart(new THREE.OctahedronGeometry(0.38, 0), 'energyCyan', { position: [0, 2.7, 0], scale: [0.8, 1.5, 0.8], emissiveIntensity: 4.0, ...spin(0, 0) });
  ring(b, 'energyCyan', 0.62, 0.035, [0, 2.7, 0], { seg: 28, animType: 2, rotation: [PI / 2 + 0.3, 0, 0] });
  ring(b, 'warningAmber', 0.5, 0.03, [0, 2.2, 0], { seg: 24, animType: 2, rotation: [PI / 2 - 0.25, 0.5, 0] });
  // banner flag
  strut(b, 'frameGunmetal', [0.75, 0.2, -0.7], [0.75, 2.4, -0.7], 0.04);
  box(b, 'hullSecondary', [0.04, 0.55, 0.7], [0.75, 1.75, -0.35], { r: 0.015, seg: 1 });
  lamp(b, 'warningAmber', 0.07, [0.75, 2.45, -0.7]);
  cable(b, [0.75, 2.3, -0.7], [0.15, 1.7, 0.1], 0.25, 0.02);
  return b.build();
}

// ---------------------------------------------------------------- Pylon (1x1)
function pylon() {
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
function capacitor() {
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
function solar() {
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
function wind() {
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
function coalGen() {
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

// ---------------------------------------------------------------- Mine (2x2): drill rig
function mine() {
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
function waterPump() {
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
function supplyDepot() {
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

// ---------------------------------------------------------------- Drone control array (2x2)
function droneArray() {
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
function roboticsFactory() {
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
function turret() {
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

// ---------------------------------------------------------------- Rocket on gantry (3x3)
function rocket() {
  const b = new KitbashBuilder();
  plinth(b, 6, 6);
  cyl(b, 'frameGunmetal', 2.0, 2.2, 0.35, [0, 0.2, 0], { seg: 24 });
  ring(b, 'warningAmber', 1.9, 0.05, [0, 0.58, 0], { seg: 36 });
  // flame trench lugs
  for (let k = 0; k < 6; k++) { const a = (k * PI) / 3 + 0.3; box(b, 'hullSecondary', [0.35, 0.3, 0.35], [Math.cos(a) * 1.7, 0.55, Math.sin(a) * 1.7], { r: 0.06, seg: 1 }); }
  // rocket body (lathe)
  const prof: THREE.Vector2[] = [];
  const pts: [number, number][] = [[0.0, 0.0], [0.5, 0.0], [0.82, 0.25], [0.88, 0.8], [0.88, 6.0], [0.8, 6.8], [0.62, 7.7], [0.38, 8.5], [0.16, 9.1], [0, 9.4]];
  for (const [r, y] of pts) prof.push(new THREE.Vector2(r, y));
  b.addPart(new THREE.LatheGeometry(prof, 20), 'hullPrimary', { position: [0, 1.0, 0] });
  b.addPart(new THREE.LatheGeometry(prof.slice(7).map((p) => new THREE.Vector2(p.x * 1.0, p.y)), 20), 'hullSecondary', { position: [0, 1.0, 0], scale: [1.03, 1.0, 1.03] });
  for (const y of [3.0, 5.2]) ring(b, 'hullSecondary', 0.9, 0.07, [0, y, 0], { seg: 24 });
  ring(b, 'frameGunmetal', 0.9, 0.05, [0, 4.1, 0], { seg: 24 });
  // porthole + glow strip
  ball(b, 'energyCyan', 0.2, [0, 6.2, 0.8], { scale: [1, 1, 0.5], emissiveIntensity: 3.8 } as any);
  glow(b, 'warningAmber', [0.08, 1.8, 0.05], [0, 3.4, 0.9]);
  // fins
  for (let k = 0; k < 4; k++) {
    const a = (k * PI) / 2 + PI / 4;
    const geo = new RoundedBoxGeometry(0.1, 2.0, 0.9, 2, 0.03);
    b.addPart(geo, 'hullSecondary', { position: [Math.cos(a) * 1.05, 1.9, Math.sin(a) * 1.05], rotation: [0, -a + PI / 2, 0.0] });
  }
  // engine bell
  cyl(b, 'frameGunmetal', 0.3, 0.55, 0.6, [0, 0.6, 0], { seg: 12 });
  cyl(b, 'energyCyan', 0.3, 0.3, 0.05, [0, 0.62, 0], { seg: 12, emissiveIntensity: 3.8 });
  // gantry tower (right of rocket)
  const gx = 2.3, gz = 0.0;
  lattice(b, 0.55, 0.45, 0.2, 9.0, 8, 0.08, {}, gx, gz);
  box(b, 'hullSecondary', [1.4, 0.3, 1.4], [gx, 9.0, gz], { r: 0.08 });
  lamp(b, 'dangerCrimson', 0.12, [gx, 9.6, gz]);
  strut(b, 'frameGunmetal', [gx, 9.3, gz], [gx + 0.1, 10.1, gz], 0.04);
  for (const y of [3.0, 5.2, 7.4]) {
    box(b, 'hullPrimary', [1.5, 0.12, 1.5], [gx, y, gz], { r: 0.03, seg: 1 });
    // swing arm to rocket
    strut(b, 'hullSecondary', [gx - 0.55, y + 0.1, gz], [0.9, y + 0.1, gz], 0.07);
    strut(b, 'frameGunmetal', [gx - 0.55, y + 0.6, gz], [1.0, y + 0.1, gz], 0.035);
    lamp(b, 'warningAmber', 0.07, [gx + 0.6, y + 0.2, gz + 0.6]);
  }
  glow(b, 'energyCyan', [0.05, 8.0, 0.05], [gx - 0.55, 0.6, gz + 0.55]);
  // fuel sphere + pipes
  ball(b, 'hullPrimary', 0.8, [-1.9, 1.35, 1.9], { seg: 18 });
  ring(b, 'energyCyan', 0.8, 0.04, [-1.9, 1.35, 1.9], { seg: 24 });
  for (const a of [0.7, 2.4, 4.0]) strut(b, 'frameGunmetal', [-1.9 + Math.cos(a) * 0.6, 0.2, 1.9 + Math.sin(a) * 0.6], [-1.9 + Math.cos(a) * 0.4, 0.8, 1.9 + Math.sin(a) * 0.4], 0.05);
  strut(b, 'hullSecondary', [-1.5, 1.0, 1.5], [-0.9, 1.4, 0.7], 0.09);
  // sagging umbilical cables tower -> rocket
  cable(b, [gx - 0.5, 8.6, gz], [0.8, 6.8, 0.2], 1.0, 0.05);
  cable(b, [gx - 0.5, 7.0, gz + 0.3], [0.85, 4.6, 0.3], 0.7, 0.04);
  cable(b, [gx, 3.2, gz + 0.6], [1.6, 0.7, 1.6], 0.4, 0.07);
  return b.build();
}

const reg = (id: string, label: string, create: () => THREE.BufferGeometry, footprint: [number, number], notes: string) =>
  ArchetypeCatalog.register({ id, label, category: 'building', create, footprint, notes: `${notes} Footprint in 2 m tiles.` });

reg('building.commandHub', 'Command Hub', commandHub, [3, 3], 'Hero: domed hull, landing pad, tilted antenna, rotating radar dish, tanks, guy cables.');
reg('building.claimBeacon', 'Claim Beacon', claimBeacon, [1, 1], 'Obelisk w/ spinning crystal, bobbing rings, banner.');
reg('building.pylon', 'Pylon', pylon, [1, 1], 'Lattice power pylon, insulator crossarms, sagging line cables.');
reg('building.capacitor', 'Capacitor', capacitor, [1, 1], 'Three cyan-banded cells with bus cables.');
reg('building.solar', 'Solar Array', solar, [2, 2], 'Two tilted hex-cell wings, inverter box, tracker mast.');
reg('building.wind', 'Wind Turbine', wind, [2, 2], 'Vertical-axis rotor (animType 1) on mast.');
reg('building.coalGen', 'Coal Generator', coalGen, [2, 2], 'Boiler drum, 3 stacks, hopper, conveyor, ember door.');
reg('building.mine', 'Mine', mine, [2, 2], 'Derrick with spinning drill string (animType 1), ore bin, hut.');
reg('building.waterPump', 'Water Pump', waterPump, [1, 1], 'Spherical water tower, pump house, pipes.');
reg('building.supplyDepot', 'Supply Depot', supplyDepot, [2, 2], 'Vaulted warehouse, crates, gantry crane.');
reg('building.droneArray', 'Drone Control Array', droneArray, [2, 2], 'Tower + 3 rotating dishes, pads, hovering drone (animType 2).');
reg('building.roboticsFactory', 'Robotics Factory', roboticsFactory, [4, 3], 'Sawtooth hall, roof gantry arm, conveyor w/ robot torso.');
reg('building.turret', 'Turret', turret, [1, 1], 'Rotating sensor head (1), twin barrels (animType 3 recoil).');
reg('building.rocket', 'Rocket', rocket, [3, 3], 'Hero landmark: rocket on pad with lattice gantry, fuel sphere, umbilicals.');
