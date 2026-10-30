// Rocket on gantry.
import * as THREE from 'three';
import { KitbashBuilder } from '../../KitbashRegistry';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { box, cyl, ball, ring, strut, cable, lamp, glow, plinth, lattice } from './kit';

const PI = Math.PI;

// ---------------------------------------------------------------- Rocket on gantry (3x3)
export function rocket() {
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
