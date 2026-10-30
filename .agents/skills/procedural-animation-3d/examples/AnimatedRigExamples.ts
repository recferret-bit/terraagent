// .agents/skills/procedural-animation-3d/examples/AnimatedRigExamples.ts
import * as THREE from 'three';
import { KitbashBuilder, type MaterialZoneId } from '../../procedural-kitbash-3d/examples/KitbashRegistry';

type V3 = [number, number, number];
const cyl = (rt: number, rb: number, h: number, seg = 10) => new THREE.CylinderGeometry(rt, rb, h, seg);
const sph = (r: number, ws = 8, hs = 6) => new THREE.SphereGeometry(r, ws, hs);
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

function strut(b: KitbashBuilder, a: V3, c: V3, r: number, zone: MaterialZoneId, opts: any = {}, rEnd = r) {
  const va = new THREE.Vector3(...a), vc = new THREE.Vector3(...c), dir = vc.clone().sub(va);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  const e = new THREE.Euler().setFromQuaternion(q), mid = va.add(vc).multiplyScalar(0.5);
  b.addPart(cyl(rEnd, r, dir.length(), 8), zone, { ...opts, position: [mid.x, mid.y, mid.z], rotation: [e.x, e.y, e.z] });
}

/**
 * Example 1: Articulated Spider Leg (`animType: 6`)
 * Every part of the leg shares the same hip socket `animPivot` so the coxa, femur,
 * knee, tibia, and foot swivel and lift as one cohesive assembly with zero joint tearing.
 */
export function addSpiderLegPair(b: KitbashBuilder, zSign: 1 | -1) {
  for (const s of [1, -1] as const) {
    const z = 0.4 * zSign;
    const hip: V3 = [0.39 * s, 0.76, z * 0.8];
    const femurStart: V3 = [0.46 * s, 0.8, z * 0.86]; // >= 1.5 cm clear of static carapace at x = ±0.40
    const knee: V3 = [0.78 * s, 1.0, z * 1.2];
    const femurEnd: V3 = [0.73 * s, 0.97, z * 1.15];
    const tibiaStart: V3 = [0.8 * s, 0.94, z * 1.21];
    const footTop: V3 = [0.92 * s, 0.08, z * 1.3];
    const animOpts = { animType: 6 as const, animPivot: hip };

    b.addPart(sph(0.095), 'frameGunmetal', { name: 'leg hip', position: hip, ...animOpts });
    strut(b, femurStart, femurEnd, 0.044, 'rubberDark', { name: 'leg femur', ...animOpts }, 0.052);
    b.addPart(sph(0.075), 'frameGunmetal', { name: 'leg knee', position: knee, ...animOpts });
    strut(b, tibiaStart, footTop, 0.028, 'rubberDark', { name: 'leg tibia', ...animOpts }, 0.05);
    b.addPart(cyl(0.085, 0.115, 0.1, 8), 'rubberDark', { name: 'leg foot', position: [footTop[0], 0.05, footTop[2]], ...animOpts });
    b.addPart(cyl(0.095, 0.095, 0.03, 8), 'hullSecondary', { name: 'leg foot rim', position: [footTop[0], 0.09, footTop[2]], ...animOpts });
  }
}

/**
 * Example 2: Coupled Bipedal Leg (`animType: 4`) & Counter-Swinging Arm (`animType: 5`)
 * Left (s = +1) and Right (s = -1) automatically alternate phase by PI in the vertex shader.
 */
export function addBipedLimbPair(b: KitbashBuilder) {
  for (const s of [1, -1] as const) {
    const x = 0.2 * s;
    const hip: V3 = [x, 1.04, 0];
    const legAnim = { animType: 4 as const, animPivot: hip };
    b.addPart(sph(0.085), 'frameGunmetal', { name: 'leg hip', position: hip, ...legAnim });
    b.addPart(box(0.18, 0.26, 0.2), 'rubberDark', { name: 'leg thigh', position: [x, 0.86, 0], ...legAnim });
    b.addPart(sph(0.085), 'frameGunmetal', { name: 'leg knee', position: [x, 0.71, 0.01], ...legAnim });
    b.addPart(box(0.18, 0.44, 0.2), 'rubberDark', { name: 'leg shin', position: [x, 0.49, 0], ...legAnim });
    b.addPart(cyl(0.06, 0.07, 0.2, 8), 'frameGunmetal', { name: 'leg ankle', position: [x, 0.2, 0], ...legAnim });
    b.addPart(box(0.24, 0.12, 0.42), 'rubberDark', { name: 'leg foot', position: [x, 0.06, 0.04], ...legAnim });

    // Static shoulder bracket bridges torso to animated shoulder ball-joint
    b.addPart(box(0.1, 0.1, 0.12), 'frameGunmetal', { name: 'shoulder mount', position: [0.35 * s, 1.5, 0] });
    const shoulder: V3 = [0.44 * s, 1.48, 0];
    const armAnim = { animType: 5 as const, animPivot: shoulder };
    const ax = 0.465 * s;
    b.addPart(sph(0.11), 'hullSecondary', { name: 'arm shoulder', position: shoulder, ...armAnim });
    b.addPart(box(0.11, 0.26, 0.13), 'hullSecondary', { name: 'arm upper', position: [ax, 1.28, 0.01], ...armAnim });
    b.addPart(sph(0.075), 'frameGunmetal', { name: 'arm elbow', position: [ax, 1.11, 0.03], ...armAnim });
    b.addPart(box(0.12, 0.28, 0.14), 'hullSecondary', { name: 'arm forearm', position: [ax, 0.95, 0.12], rotation: [-0.45, 0, 0], ...armAnim });
    b.addPart(box(0.1, 0.1, 0.11), 'frameGunmetal', { name: 'arm hand', position: [ax, 0.8, 0.23], ...armAnim });
  }
}

/**
 * Example 3: Rolling 3-Tone Rover Wheel (`animType: 7`)
 * Tyre, rim, and hub cap share the axle `wPivot` so they roll around +X in lockstep.
 */
export function addRollingWheel(b: KitbashBuilder, wPivot: V3) {
  b.addPart(cyl(0.17, 0.17, 0.12, 12), 'rubberDark', { name: 'wheel tyre', position: wPivot, rotation: [0, 0, Math.PI / 2], animType: 7, animPivot: wPivot });
  b.addPart(cyl(0.105, 0.105, 0.14, 12), 'hullPrimary', { name: 'wheel rim', position: wPivot, rotation: [0, 0, Math.PI / 2], animType: 7, animPivot: wPivot });
  b.addPart(cyl(0.045, 0.045, 0.16, 8), 'hullSecondary', { name: 'wheel hub', position: wPivot, rotation: [0, 0, Math.PI / 2], animType: 7, animPivot: wPivot });
}
