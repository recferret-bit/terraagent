// Command hub + claim beacon.
import * as THREE from 'three';
import { KitbashBuilder } from '../../KitbashRegistry';
import { box, cyl, capsule, ring, strut, cable, lamp, glow, dish, plinth, type V3, spin } from './kit';

const PI = Math.PI;

// ---------------------------------------------------------------- Command Hub (3x3)
export function commandHub() {
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
export function claimBeacon() {
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
