import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { KitbashBuilder, type MaterialZoneId, type PartOptions } from '../../KitbashRegistry';

export type V3 = [number, number, number];
export type Z = MaterialZoneId;
export type Opt = PartOptions & { seg?: number; r?: number };

const _q = new THREE.Quaternion();
const Y = new THREE.Vector3(0, 1, 0);

/** Rounded box; `p` = [x, bottomY, z]. */
export function box(b: KitbashBuilder, z: Z, s: V3, p: V3, o: Opt = {}) {
  const r = Math.min(o.r ?? 0.06, Math.min(...s) * 0.45);
  b.addPart(new RoundedBoxGeometry(s[0], s[1], s[2], o.seg ?? 2, r), z, { ...o, position: [p[0], p[1] + s[1] / 2, p[2]] });
}
/** Cylinder; `p` = [x, bottomY, z]. */
export function cyl(b: KitbashBuilder, z: Z, rt: number, rb: number, h: number, p: V3, o: Opt = {}) {
  b.addPart(new THREE.CylinderGeometry(rt, rb, h, o.seg ?? 16, 1), z, { ...o, position: [p[0], p[1] + h / 2, p[2]] });
}
/** Sphere centred at p. */
export function ball(b: KitbashBuilder, z: Z, r: number, p: V3, o: Opt = {}) {
  b.addPart(new THREE.SphereGeometry(r, o.seg ?? 14, 10), z, { ...o, position: p });
}
export function capsule(b: KitbashBuilder, z: Z, r: number, len: number, p: V3, o: Opt = {}) {
  b.addPart(new THREE.CapsuleGeometry(r, len, 4, o.seg ?? 12), z, { ...o, position: [p[0], p[1] + len / 2 + r, p[2]] });
}
/** Torus centred at p; flat (axis Y) by default. */
export function ring(b: KitbashBuilder, z: Z, R: number, t: number, p: V3, o: Opt = {}) {
  b.addPart(new THREE.TorusGeometry(R, t, 8, o.seg ?? 28), z, { rotation: [Math.PI / 2, 0, 0], ...o, position: p });
}
/** Cylinder strut between two points. */
export function strut(b: KitbashBuilder, z: Z, a: V3, c: V3, r = 0.05, o: Opt = {}) {
  const va = new THREE.Vector3(...a), vc = new THREE.Vector3(...c);
  const d = vc.clone().sub(va); const len = d.length();
  _q.setFromUnitVectors(Y, d.normalize());
  const e = new THREE.Euler().setFromQuaternion(_q);
  const m = va.add(vc).multiplyScalar(0.5);
  b.addPart(new THREE.CylinderGeometry(r, r, len, o.seg ?? 6, 1), z, { ...o, position: [m.x, m.y, m.z], rotation: [e.x, e.y, e.z] });
}
/** Sagging CatmullRom cable (silhouette breaker). */
export function cable(b: KitbashBuilder, a: V3, c: V3, slack = 0.4, r = 0.04, z: Z = 'frameGunmetal') {
  const va = new THREE.Vector3(...a), vc = new THREE.Vector3(...c);
  const m = va.clone().add(vc).multiplyScalar(0.5); m.y -= slack;
  const q1 = va.clone().lerp(m, 0.5); q1.y -= slack * 0.15;
  const q2 = m.clone().lerp(vc, 0.5); q2.y -= slack * 0.15;
  const curve = new THREE.CatmullRomCurve3([va, q1, m, q2, vc]);
  b.addPart(new THREE.TubeGeometry(curve, 14, r, 5, false), z);
}
/** Emissive lamp (HDR, >=3). */
export function lamp(b: KitbashBuilder, z: 'energyCyan' | 'warningAmber' | 'dangerCrimson' | 'terraformEmerald', r: number, p: V3, o: Opt = {}) {
  ball(b, z, r, p, { seg: 8, ...o });
}
/** Emissive slab strip; p = [x,bottomY,z]. */
export function glow(b: KitbashBuilder, z: 'energyCyan' | 'warningAmber' | 'dangerCrimson', s: V3, p: V3, o: Opt = {}) {
  box(b, z, s, p, { r: 0.015, seg: 1, ...o });
}
/** Parabolic dish (double-sided shell). Centre of bowl rim at p; opens +Y before tilt. */
export function dish(b: KitbashBuilder, R: number, p: V3, tilt: number, o: Opt = {}) {
  const pts: THREE.Vector2[] = [];
  const n = 8, k = 0.55 / R, th = 0.04;
  for (let i = 0; i <= n; i++) { const r = (R * i) / n; pts.push(new THREE.Vector2(r, k * r * r)); }
  for (let i = n; i >= 0; i--) { const r = (R * i) / n; pts.push(new THREE.Vector2(r, k * r * r - th)); }
  const g = new THREE.LatheGeometry(pts, 20);
  b.addPart(g, 'hullPrimary', { ...o, position: p, rotation: [tilt, 0, 0] });
}
/** Octagonal foundation plinth (-0.1..0.2) with amber hazard trim and corner lamps. Returns top Y. */
export function plinth(b: KitbashBuilder, w: number, d: number, accent = true): number {
  box(b, 'frameGunmetal', [w, 0.3, d], [0, -0.1, 0], { r: 0.1, seg: 3 });
  if (accent) {
    const iw = w - 0.3, id = d - 0.3;
    for (const s of [-1, 1]) {
      box(b, 'hullSecondary', [iw, 0.04, 0.1], [0, 0.2, s * id / 2], { r: 0.015, seg: 1 });
      box(b, 'hullSecondary', [0.1, 0.04, id - 0.1], [s * iw / 2, 0.2, 0], { r: 0.015, seg: 1 });
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) lamp(b, 'warningAmber', 0.07, [sx * (w / 2 - 0.12), 0.24, sz * (d / 2 - 0.12)]);
  }
  return 0.2;
}
/** 4-legged lattice tower from base half-size r0 to top half-size r1. */
export function lattice(b: KitbashBuilder, r0: number, r1: number, y0: number, y1: number, panels = 4, rail = 0.06, o: Opt = {}, cx = 0, cz = 0) {
  const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const at = (i: number, t: number): V3 => { const r = r0 + (r1 - r0) * t; return [cx + c[i][0] * r, y0 + (y1 - y0) * t, cz + c[i][1] * r]; };
  for (let i = 0; i < 4; i++) strut(b, 'frameGunmetal', at(i, 0), at(i, 1), rail, o);
  for (let k = 0; k < panels; k++) {
    const t0 = k / panels, t1 = (k + 1) / panels;
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      strut(b, 'frameGunmetal', at(i, t0), at(j, t1), rail * 0.55, o);
      strut(b, 'frameGunmetal', at(i, t1), at(j, t1), rail * 0.55, o);
    }
  }
}
export function triCount(g: THREE.BufferGeometry) { return (g.index ? g.index.count : g.attributes.position.count) / 3; }
