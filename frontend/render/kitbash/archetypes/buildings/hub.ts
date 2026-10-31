// Command hub + claim beacon.
import * as THREE from 'three';
import { KitbashBuilder } from '../../KitbashRegistry';
import { box, cyl, ring, strut, cable, lamp, plinth, type V3, spin, type Z, type Opt } from './kit';

const PI = Math.PI;

function hubLamp(b: KitbashBuilder, z: Z, r: number, p: V3, o: Opt = {}) {
  b.addPart(new THREE.SphereGeometry(r, 6, 4), z, { ...o, position: p });
}

function hubRing(b: KitbashBuilder, z: Z, R: number, t: number, p: V3, seg = 12, o: Opt = {}) {
  b.addPart(new THREE.TorusGeometry(R, t, 4, seg), z, { rotation: [PI / 2, 0, 0], ...o, position: p });
}

function hubCable(b: KitbashBuilder, a: V3, c: V3, slack: number, r: number, name: string) {
  const va = new THREE.Vector3(...a), vc = new THREE.Vector3(...c);
  const m = va.clone().add(vc).multiplyScalar(0.5);
  m.y -= slack;
  const curve = new THREE.CatmullRomCurve3([va, m, vc]);
  b.addPart(new THREE.TubeGeometry(curve, 8, r, 4, false), 'frameGunmetal', { name });
}

function addHubFoundationAndHull(b: KitbashBuilder) {
  // Grounded octagonal plinth flush at Y = 0.000
  box(b, 'frameGunmetal', [6, 0.2, 6], [0, 1e-5, 0], { r: 0.08, seg: 1, name: 'foundation plinth' });
  const iw = 5.7, id = 5.7;
  for (const s of [-1, 1]) {
    b.addPart(new THREE.BoxGeometry(iw, 0.04, 0.1), 'hullSecondary', { name: 'plinth border Z', position: [0, 0.2, s * id / 2] });
    b.addPart(new THREE.BoxGeometry(0.1, 0.044, id - 0.04), 'hullSecondary', { name: 'plinth border X', position: [s * iw / 2, 0.202, 0] });
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    hubLamp(b, 'warningAmber', 0.07, [sx * 2.88, 0.22, sz * 2.88], { name: 'plinth corner light' });
  }
  // Main hull + waist band + upper hull + dome drum + dome + ribs
  box(b, 'hullPrimary', [4.4, 1.34, 4.2], [-0.2, 0.16, -0.2], { r: 0.16, seg: 1, name: 'command lower hull' });
  box(b, 'frameGunmetal', [4.5, 0.18, 4.3], [-0.2, 1.1, -0.2], { r: 0.04, seg: 1, name: 'hull waist band' });
  box(b, 'hullPrimary', [3.8, 0.65, 3.6], [-0.2, 1.4, -0.2], { r: 0.14, seg: 1, name: 'command upper hull' });
  cyl(b, 'hullPrimary', 1.5, 1.7, 0.77, [-0.2, 1.96, -0.2], { seg: 14, name: 'dome drum' });
  hubRing(b, 'energyCyan', 1.52, 0.06, [-0.2, 2.72, -0.2], 14, { name: 'dome collar light' });
  b.addPart(new THREE.SphereGeometry(1.38, 12, 6, 0, PI * 2, 0, PI / 2), 'glassVisor', { name: 'dome canopy glass', position: [-0.2, 2.68, -0.2] });
  for (let i = 0; i < 4; i++) {
    b.addPart(new THREE.TorusGeometry(1.39, 0.035, 4, 10, PI), 'frameGunmetal', {
      name: 'dome arch',
      position: [-0.2, 2.68, -0.2],
      rotation: [0, (i * PI) / 4, 0],
    });
  }
  // 4 corner columns + beacons
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    cyl(b, 'frameGunmetal', 0.2, 0.26, 1.56, [-0.2 + sx * 2.2, 0.14, -0.2 + sz * 2.1], { seg: 8, name: 'corner column' });
    hubLamp(b, 'warningAmber', 0.1, [-0.2 + sx * 2.2, 1.74, -0.2 + sz * 2.1], { name: 'column beacon light' });
  }
  // Front entry airlock
  box(b, 'frameGunmetal', [1.6, 1.02, 0.34], [-0.2, 0.18, 1.92], { r: 0.06, seg: 1, name: 'entry airlock' });
  b.addPart(new THREE.BoxGeometry(1.2, 0.15, 0.06), 'energyCyan', { name: 'airlock header light', position: [-0.2, 0.825, 2.08], emissiveIntensity: 3.8 });
  b.addPart(new THREE.BoxGeometry(0.12, 0.7, 0.06), 'energyCyan', { name: 'airlock frame light L', position: [-0.9, 0.63, 2.08] });
  b.addPart(new THREE.BoxGeometry(0.12, 0.7, 0.06), 'energyCyan', { name: 'airlock frame light R', position: [0.5, 0.63, 2.08] });
}

function addHubPadAndTanks(b: KitbashBuilder) {
  // Landing pad wing (+x, +z)
  box(b, 'frameGunmetal', [2.1, 0.3, 2.1], [2.35, 0.15, 1.7], { r: 0.08, seg: 1, name: 'landing pad base' });
  cyl(b, 'hullPrimary', 1.0, 1.0, 0.14, [2.35, 0.43, 1.7], { seg: 14, name: 'landing pad deck' });
  hubRing(b, 'warningAmber', 0.85, 0.04, [2.35, 0.57, 1.7], 14, { name: 'pad ring light' });
  b.addPart(new THREE.BoxGeometry(0.12, 0.04, 0.8), 'warningAmber', { name: 'pad H light L', position: [2.1, 0.57, 1.7] });
  b.addPart(new THREE.BoxGeometry(0.12, 0.04, 0.8), 'warningAmber', { name: 'pad H light R', position: [2.6, 0.57, 1.7] });
  b.addPart(new THREE.BoxGeometry(0.42, 0.044, 0.1), 'warningAmber', { name: 'pad H light cross', position: [2.35, 0.572, 1.7] });
  // Storage tanks (left-back) clear of corner column and without degenerate pole caps
  for (const k of [0, 1]) {
    const tx = -1.9 + k * 0.95;
    cyl(b, 'hullSecondary', 0.38, 0.4, 1.65, [tx, 0.14, -2.45], { seg: 10, name: `storage tank ${k + 1}` });
    cyl(b, 'frameGunmetal', 0.24, 0.38, 0.16, [tx, 1.76, -2.45], { seg: 10, name: `tank cap ${k + 1}` });
  }
  box(b, 'frameGunmetal', [1.85, 0.14, 0.36], [-1.42, 1.05, -2.35], { r: 0.03, seg: 1, name: 'tank manifold' });
  // Power cable routed outside solid hulls from lower hull (+X wall) to landing pad (-Z edge)
  const pCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(1.98, 0.85, 0.32),
    new THREE.Vector3(2.2, 0.62, 0.52),
    new THREE.Vector3(2.35, 0.42, 0.68),
  ]);
  b.addPart(new THREE.TubeGeometry(pCurve, 8, 0.045, 4, false), 'frameGunmetal', { name: 'pad power cable' });
}

function addHubAntennaAndRadar(b: KitbashBuilder) {
  // Main tall antenna (angled) + collars + guy cables
  box(b, 'hullSecondary', [0.42, 0.52, 0.42], [1.0, 1.85, -1.4], { r: 0.06, seg: 1, name: 'antenna base' });
  strut(b, 'frameGunmetal', [1.0, 1.9, -1.4], [1.35, 6.4, -1.75], 0.08, { seg: 6, name: 'antenna mast' });
  for (const h of [3.4, 4.6]) {
    const t = (h - 1.9) / 4.5;
    const pos: V3 = [1.0 + 0.35 * t, h, -1.4 - 0.35 * t];
    hubRing(b, 'hullSecondary', 0.09, 0.045, pos, 8, { name: 'antenna collar' });
  }
  hubLamp(b, 'dangerCrimson', 0.13, [1.35, 6.46, -1.75], { emissiveIntensity: 4.2, name: 'antenna beacon light' });
  hubCable(b, [1.31, 5.9, -1.71], [2.0, 1.68, -2.28], 0.15, 0.025, 'antenna guy cable R');
  hubCable(b, [1.28, 5.5, -1.68], [-0.4, 2.01, -1.96], 0.15, 0.025, 'antenna guy cable L');
  // Rotating radar tower (left-front top)
  box(b, 'hullSecondary', [0.9, 0.36, 0.9], [-1.4, 1.99, 0.7], { r: 0.05, seg: 1, name: 'radar pedestal' });
  cyl(b, 'frameGunmetal', 0.12, 0.2, 1.92, [-1.4, 2.3, 0.7], { seg: 8, name: 'radar mast' });
  const R = 0.85, n = 4, k = 0.55 / R, th = 0.04;
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= n; i++) {
    const r = Math.max(0.02, (R * i) / n);
    pts.push(new THREE.Vector2(r, k * r * r));
  }
  for (let i = n; i >= 0; i--) {
    const r = Math.max(0.02, (R * i) / n);
    pts.push(new THREE.Vector2(r, k * r * r - th));
  }
  b.addPart(new THREE.LatheGeometry(pts, 10), 'hullPrimary', {
    name: 'radar dish',
    position: [-1.4, 4.19, 0.7],
    rotation: [-0.55, 0, 0],
    ...spin(-1.4, 0.7),
  });
  cyl(b, 'frameGunmetal', 0.05, 0.05, 0.5, [-1.4, 4.09, 0.7], { seg: 6, name: 'radar feed rod', ...spin(-1.4, 0.7) });
  b.addPart(new THREE.BoxGeometry(0.1, 0.1, 0.1), 'energyCyan', {
    name: 'radar feed light',
    position: [-1.4, 4.57, 0.7],
    ...spin(-1.4, 0.7),
  });
}

// ---------------------------------------------------------------- Command Hub (3x3)
export function commandHub() {
  const b = new KitbashBuilder();
  addHubFoundationAndHull(b);
  addHubPadAndTanks(b);
  addHubAntennaAndRadar(b);
  return b.build();
}

// ---------------------------------------------------------------- Claim Beacon (1x1)
export function claimBeacon() {
  const b = new KitbashBuilder();
  plinth(b, 2, 2);
  cyl(b, 'hullPrimary', 0.5, 0.75, 0.52, [0, 0.18, 0], { seg: 8, name: 'obelisk pedestal' });
  ring(b, 'hullSecondary', 0.62, 0.05, [0, 0.62, 0], { seg: 8, name: 'pedestal collar' });
  cyl(b, 'frameGunmetal', 0.22, 0.34, 1.62, [0, 0.68, 0], { seg: 8, name: 'obelisk column' });
  for (const a of [0, 1, 2]) {
    const an = a * 2.094 + 0.4;
    strut(b, 'hullSecondary', [Math.cos(an) * 0.55, 0.62, Math.sin(an) * 0.55], [Math.cos(an) * 0.2, 2.1, Math.sin(an) * 0.2], 0.06, { name: `column buttress ${a + 1}` });
  }
  const A = spin(0, 0);
  cyl(b, 'frameGunmetal', 0.07, 0.09, 0.65, [0, 2.22, 0], { seg: 8, name: 'emitter spindle', ...A });
  b.addPart(new THREE.OctahedronGeometry(0.36, 0), 'energyCyan', { name: 'beacon crystal light', position: [0, 2.75, 0], scale: [0.8, 1.45, 0.8], emissiveIntensity: 4.0, ...A });
  strut(b, 'frameGunmetal', [-0.62, 2.75, 0], [0.62, 2.75, 0], 0.025, { name: 'upper ring spoke', ...A });
  ring(b, 'energyCyan', 0.62, 0.035, [0, 2.75, 0], { seg: 14, name: 'upper gyro ring light', rotation: [PI / 2 + 0.3, 0, 0], ...A });
  strut(b, 'frameGunmetal', [-0.5, 2.38, 0], [0.5, 2.38, 0], 0.025, { name: 'lower ring spoke', ...A });
  ring(b, 'warningAmber', 0.5, 0.03, [0, 2.38, 0], { seg: 14, name: 'lower gyro ring light', rotation: [PI / 2 - 0.25, 0, 0], ...A });
  // banner flag
  strut(b, 'frameGunmetal', [0.75, 0.18, -0.7], [0.75, 2.42, -0.7], 0.04, { name: 'banner mast' });
  box(b, 'hullSecondary', [0.04, 0.55, 0.72], [0.75, 1.75, -0.36], { r: 0.015, seg: 1, name: 'faction banner' });
  lamp(b, 'warningAmber', 0.07, [0.75, 2.44, -0.7], { name: 'banner mast light' });
  cable(b, [0.75, 2.32, -0.7], [0.18, 1.65, -0.18], 0.22, 0.02, 'frameGunmetal', { name: 'banner guy cable' });
  return b.build();
}
