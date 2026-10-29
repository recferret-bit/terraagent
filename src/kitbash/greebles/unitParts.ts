import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { KitbashBuilder, KitbashRegistry } from '../KitbashRegistry';
import type { MaterialZoneId, PartOptions } from '../KitbashRegistry';

export type V3 = [number, number, number];
export type Zone = MaterialZoneId;

export const rbox = (w: number, h: number, d: number, r = 0.04) =>
  new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
export const cyl = (rt: number, rb: number, h: number, seg = 12) => new THREE.CylinderGeometry(rt, rb, h, seg);
export const sph = (r: number, ws = 14, hs = 10) => new THREE.SphereGeometry(r, ws, hs);

/** Mulberry32 seeded rng. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cylinder strut from a to c (ends flush on the points). */
export function strut(b: KitbashBuilder, a: V3, c: V3, r: number, zone: Zone, opts: PartOptions = {}, rEnd = r) {
  const va = new THREE.Vector3(...a);
  const vc = new THREE.Vector3(...c);
  const dir = vc.clone().sub(va);
  const len = dir.length();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  const e = new THREE.Euler().setFromQuaternion(q);
  const mid = va.clone().add(vc).multiplyScalar(0.5);
  b.addPart(cyl(rEnd, r, len, 8), zone, { ...opts, position: mid.toArray() as V3, rotation: [e.x, e.y, e.z] });
}

/** Tube through points (CatmullRom). */
export function cable(b: KitbashBuilder, pts: V3[], r = 0.02, zone: Zone = 'frameGunmetal', opts: PartOptions = {}) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
  b.addPart(new THREE.TubeGeometry(curve, 14, r, 6, false), zone, opts);
}

/** Sagging cable between two points. */
export function sag(b: KitbashBuilder, p1: V3, p2: V3, slack = 0.12, r = 0.02, zone: Zone = 'frameGunmetal') {
  const m: V3 = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2 - slack, (p1[2] + p2[2]) / 2];
  cable(b, [p1, m, p2], r, zone);
}

/** Mirror helper: run fn for x sign +1 and -1. */
export function mirror(fn: (s: 1 | -1) => void) {
  fn(1);
  fn(-1);
}

/** Jittered low-poly rock (icosahedron). */
export function rockGeo(radius: number, seed: number, squash = 1, detail = 1) {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  const r = rng(seed);
  const p = g.attributes.position as THREE.BufferAttribute;
  const cache = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let k = cache.get(key);
    if (k === undefined) { k = 0.78 + r() * 0.44; cache.set(key, k); }
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * squash, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

/** Lathe from [radius, y] profile. */
export function lathe(profile: [number, number][], seg = 20, phiStart = 0, phiLen = Math.PI * 2) {
  return new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), seg, phiStart, phiLen);
}

// ---- Registered greebles (reusable by other agents) ----

/** Pair of hover/retro thruster nozzle: bell + glowing core that bobs (animType 2). */
KitbashRegistry.registerGreeble(
  'hoverThruster',
  ({ position = [0, 0, 0], radius = 0.1, length = 0.14, bob = true, down = true }: any, b: KitbashBuilder) => {
    const dy = down ? 1 : -1;
    b.addPart(cyl(radius * 0.7, radius * 1.1, length, 12), 'frameGunmetal', { position: [position[0], position[1], position[2]] });
    b.addPart(cyl(radius * 0.8, radius * 0.5, 0.03, 12), 'energyCyan', {
      position: [position[0], position[1] - dy * length * 0.5, position[2]],
      emissiveIntensity: 4.2,
      animType: bob ? 2 : 0,
    });
  }
);

/** Tracked drive unit (rounded housing, bogie wheels, sprockets). */
KitbashRegistry.registerGreeble(
  'trackUnit',
  ({ x = 0.3, length = 1.0, height = 0.3, width = 0.22 }: any, b: KitbashBuilder) => {
    b.addPart(rbox(width, height, length, 0.1), 'frameGunmetal', { position: [x, height / 2, 0] });
    const n = 4;
    for (let i = 0; i < n; i++) {
      const z = -length / 2 + length * 0.12 + (i / (n - 1)) * length * 0.76;
      const out = Math.sign(x) * (width / 2 + 0.005);
      b.addPart(cyl(height * 0.34, height * 0.34, 0.03, 12), 'hullSecondary', {
        position: [x + out, height / 2, z],
        rotation: [0, 0, Math.PI / 2],
      });
    }
  }
);
