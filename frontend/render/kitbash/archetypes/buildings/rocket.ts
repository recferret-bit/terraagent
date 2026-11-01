// Rocket on gantry.
import * as THREE from 'three';
import { KitbashBuilder } from '../../KitbashRegistry';
import { cyl, ball, strut, cable, lamp, glow, plinth, lattice } from './kit';

const PI = Math.PI;

// ---------------------------------------------------------------- Rocket on gantry (3x3)
export function rocket() {
  const b = new KitbashBuilder();
  plinth(b, 6, 6);
  cyl(b, 'hullSecondary', 1.65, 1.75, 0.38, [0, 0.18, 0], { seg: 12, name: 'launch pad blast deck' });
  cyl(b, 'warningAmber', 1.56, 1.56, 0.05, [0, 0.54, 0], { seg: 12, emissiveIntensity: 3.4, name: 'pad hazard ring light' });
  // flame trench hold-down lugs
  for (let k = 0; k < 6; k++) {
    const a = (k * PI) / 3 + 0.3;
    cyl(b, 'frameGunmetal', 0.16, 0.18, 0.3, [Math.cos(a) * 1.42, 0.5, Math.sin(a) * 1.42], { seg: 6, name: 'hold-down lug' });
  }
  // rocket body (lathe, clamped r >= 0.015 so pole caps have no degenerate zero-area tris)
  const prof: THREE.Vector2[] = [];
  const pts: [number, number][] = [[0.015, 0.0], [0.5, 0.0], [0.82, 0.25], [0.88, 0.8], [0.88, 6.0], [0.8, 6.8], [0.62, 7.7], [0.38, 8.5], [0.16, 9.1], [0.015, 9.4]];
  for (const [r, y] of pts) prof.push(new THREE.Vector2(r, y));
  b.addPart(new THREE.LatheGeometry(prof, 12), 'hullPrimary', { name: 'rocket main stage', position: [0, 1.0, 0] });
  b.addPart(new THREE.LatheGeometry(prof.slice(7).map((p) => new THREE.Vector2(Math.max(0.015, p.x), p.y)), 12), 'hullSecondary', { name: 'rocket payload fairing', position: [0, 1.0, 0], scale: [1.03, 1.0, 1.03] });
  for (const y of [3.0, 5.2]) cyl(b, 'hullSecondary', 0.92, 0.92, 0.14, [0, y, 0], { seg: 12, name: 'interstage ring' });
  cyl(b, 'frameGunmetal', 0.91, 0.91, 0.1, [0, 4.1, 0], { seg: 12, name: 'tankage weld band' });
  // porthole + glow strip
  ball(b, 'energyCyan', 0.2, [0, 6.2, 0.8], { seg: 8, scale: [1, 1, 0.5], emissiveIntensity: 3.8, name: 'crew porthole light' } as any);
  cyl(b, 'warningAmber', 0.05, 0.05, 1.8, [0, 2.5, 0.88], { seg: 6, emissiveIntensity: 3.6, name: 'stage telemetry strip light' });
  // fins
  for (let k = 0; k < 4; k++) {
    const a = (k * PI) / 2 + PI / 4;
    b.addPart(new THREE.CylinderGeometry(0.18, 0.48, 2.0, 4), 'hullSecondary', {
      name: 'stabilizer fin', position: [Math.cos(a) * 1.02, 1.9, Math.sin(a) * 1.02], rotation: [0, -a + PI / 4, 0], scale: [0.22, 1, 1],
    });
  }
  // engine bell + proud plasma nozzle glow
  cyl(b, 'frameGunmetal', 0.3, 0.55, 0.6, [0, 0.6, 0], { seg: 10, name: 'main engine bell' });
  cyl(b, 'energyCyan', 0.42, 0.46, 0.08, [0, 0.55, 0], { seg: 10, emissiveIntensity: 3.8, name: 'engine nozzle glow light' });
  // gantry tower (right of rocket)
  const gx = 2.3, gz = 0.0;
  lattice(b, 0.52, 0.44, 0.18, 9.0, 3, 0.075, {}, gx, gz);
  cyl(b, 'hullSecondary', 0.78, 0.82, 0.28, [gx, 9.02, gz], { seg: 8, name: 'gantry crown deck' });
  strut(b, 'frameGunmetal', [gx, 9.26, gz], [gx + 0.08, 10.1, gz], 0.045, { name: 'arrestor finial mast' });
  lamp(b, 'dangerCrimson', 0.1, [gx + 0.08, 10.15, gz], { name: 'gantry aviation light' });
  for (const y of [3.0, 5.2, 7.4]) {
    cyl(b, 'hullPrimary', 0.82, 0.82, 0.14, [gx, y, gz], { seg: 8, name: 'gantry service deck' });
    // swing beam to rocket
    strut(b, 'hullSecondary', [gx - 0.52, y + 0.08, gz], [0.82, y + 0.08, gz], 0.07, { name: 'umbilical swing beam' });
    strut(b, 'frameGunmetal', [gx - 0.52, y + 0.58, gz], [0.95, y + 0.08, gz], 0.035, { name: 'swing beam tension stay' });
    lamp(b, 'warningAmber', 0.07, [gx + 0.48, y + 0.15, gz + 0.48], { name: 'deck edge light' });
  }
  glow(b, 'energyCyan', [0.05, 8.0, 0.05], [gx - 0.52, 0.6, gz + 0.52], { name: 'gantry elevator strip light' });
  // LOX fuel sphere + pipes
  ball(b, 'hullPrimary', 0.8, [-1.9, 1.35, 1.9], { seg: 10, name: 'cryo fuel sphere' });
  cyl(b, 'energyCyan', 0.82, 0.82, 0.06, [-1.9, 1.32, 1.9], { seg: 10, emissiveIntensity: 3.6, name: 'cryo pressure ring light' });
  for (const a of [0.7, 2.4, 4.0]) strut(b, 'frameGunmetal', [-1.9 + Math.cos(a) * 0.6, 0.18, 1.9 + Math.sin(a) * 0.6], [-1.9 + Math.cos(a) * 0.4, 0.8, 1.9 + Math.sin(a) * 0.4], 0.05, { name: 'sphere support post' });
  strut(b, 'hullSecondary', [-1.45, 1.0, 1.45], [-0.8, 1.4, 0.6], 0.09, { name: 'cryo feed line' });
  // ground umbilical junction box + sagging umbilical cables tower -> rocket
  cyl(b, 'hullSecondary', 0.24, 0.26, 0.55, [gx, 0.18, 1.45], { seg: 8, name: 'umbilical terminal unit' });
  cable(b, [gx - 0.65, 7.46, gz], [0.68, 6.8, 0.0], 0.35, 0.045, 'frameGunmetal', { name: 'upper umbilical cable' });
  cable(b, [gx - 0.65, 5.26, gz + 0.2], [0.76, 4.6, 0.15], 0.28, 0.04, 'frameGunmetal', { name: 'mid umbilical cable' });
  cable(b, [gx, 3.04, gz + 0.68], [gx, 0.68, 1.35], 0.18, 0.055, 'frameGunmetal', { name: 'ground feeder cable' });
  return b.build();
}
