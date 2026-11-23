import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { KitbashBuilder, type MaterialZoneId, type PartOptions } from '../../KitbashRegistry';
import { tubeThrough } from '../../greebles/tube';

export type V3 = [number, number, number];
export type Z = MaterialZoneId;
/**
 * Part options plus geometry budgets: `seg` = the helper's main segment count (radial, lathe, tube length), `r` = bevel
 * radius, `hSeg` = sphere height segments, `tubeSeg` = torus tube segments, `points` = cable control points (3 or 5).
 */
export type Opt = PartOptions & { seg?: number; r?: number; hSeg?: number; tubeSeg?: number; points?: 3 | 5; housing?: boolean };

const _q = new THREE.Quaternion();
const Y = new THREE.Vector3(0, 1, 0);

/** Rounded box; `p` = [x, bottomY, z]. */
export function box(b: KitbashBuilder, z: Z, s: V3, p: V3, o: Opt = {}) {
  const r = Math.min(o.r ?? 0.06, Math.min(...s) * 0.45);
  b.addPart(new RoundedBoxGeometry(s[0], s[1], s[2], o.seg ?? 1, r), z, { ...o, position: [p[0], p[1] + s[1] / 2, p[2]] });
}
/** Cylinder; `p` = [x, bottomY, z]. */
export function cyl(b: KitbashBuilder, z: Z, rt: number, rb: number, h: number, p: V3, o: Opt = {}) {
  b.addPart(new THREE.CylinderGeometry(rt, rb, h, o.seg ?? 10, 1), z, { ...o, position: [p[0], p[1] + h / 2, p[2]] });
}
/** Sphere centred at p. */
export function ball(b: KitbashBuilder, z: Z, r: number, p: V3, o: Opt = {}) {
  b.addPart(new THREE.SphereGeometry(r, o.seg ?? 10, 8), z, { ...o, position: p });
}
/**
 * Silo tank: a straight cylinder (no hemispherical caps, to save triangles) filling about the space a capsule of radius
 * `r` and body length `len` based at `p` would, from y = p.y + 0.2 r to p.y + len + 1.8 r.
 */
export function roundedTank(b: KitbashBuilder, z: Z, r: number, len: number, p: V3, o: Opt = {}) {
  b.addPart(new THREE.CylinderGeometry(r, r, len + r * 1.6, o.seg ?? 10, 1), z, { ...o, position: [p[0], p[1] + len / 2 + r, p[2]] });
}
/** Torus centred at p; flat (axis Y) by default. */
export function ring(b: KitbashBuilder, z: Z, R: number, t: number, p: V3, o: Opt = {}) {
  b.addPart(new THREE.TorusGeometry(R, t, o.tubeSeg ?? 5, Math.min(o.seg ?? 14, 16)), z, { rotation: [Math.PI / 2, 0, 0], ...o, position: p });
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
/** Tube along a CatmullRom curve through `pts` (`o.seg` segments along it, default 10; 4 around): the shared `tubeThrough`. */
export function tube(b: KitbashBuilder, pts: readonly THREE.Vector3[], r: number, z: Z = 'frameGunmetal', o: Opt = {}) {
  tubeThrough(b, pts, r, z, { along: o.seg ?? 10, radial: 4 }, o);
}
/**
 * A point on a hanging cable. `drop` is the sag at mid-span, in metres, perpendicular to the chord
 * and in the vertical plane (gravity with the along-cable part removed). A world-Y drop is not a sag:
 * on a steep span that point still sits on the chord. `t` is 0 at `a` and 1 at `c`.
 */
export function hangPoint(a: V3, c: V3, t: number, drop: number): V3 {
  const dx = c[0] - a[0], dy = c[1] - a[1], dz = c[2] - a[2];
  const len = Math.hypot(dx, dy, dz) || 1;
  const uy = dy / len;
  let px = (dx / len) * uy, py = -1 + uy * uy, pz = (dz / len) * uy;
  const pl = Math.hypot(px, py, pz) || 1;
  const s = drop * 4 * t * (1 - t);
  return [a[0] + dx * t + (px / pl) * s, a[1] + dy * t + (py / pl) * s, a[2] + dz * t + (pz / pl) * s];
}
/** Middle of a hanging cable. `drop` is a few percent of the span. */
export function sagPoint(a: V3, c: V3, drop: number): V3 {
  return hangPoint(a, c, 0.5, drop);
}
/** One hanging tube. `slack` is the mid-span sag in metres. `o.points: 3` keeps only the belly between the ends. */
export function cable(b: KitbashBuilder, a: V3, c: V3, slack = 0.4, r = 0.04, z: Z = 'frameGunmetal', o: Opt = {}) {
  const ts = o.points === 3 ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1];
  tube(b, ts.map((t) => new THREE.Vector3(...hangPoint(a, c, t, slack))), r, z, o);
}
/** Emissive bulb in a gunmetal socket. The socket bites the bulb and reaches into whatever is under it. */
export function lamp(b: KitbashBuilder, z: 'energyCyan' | 'warningAmber' | 'dangerCrimson' | 'terraformEmerald', r: number, p: V3, o: Opt = {}) {
  const { housing = true, seg, hSeg, ...part } = o;
  const name = part.name ?? 'status light';
  b.addPart(new THREE.SphereGeometry(r, seg ?? 6, hSeg ?? 5), z, { ...part, name, position: p });
  if (housing) seatLamp(b, r, p, part, name);
}

/** Neck under the bulb: 3.5 cm inside the sphere, 4 cm below it. The name must not say light: it is the metal, not the glow. */
function seatLamp(b: KitbashBuilder, r: number, p: V3, part: Opt, name: string) {
  const h = 0.075;
  const base = name.replace(/\b(lights?|lamps?|beacons?|bulbs?)\b/gi, '').replace(/\s+/g, ' ').trim();
  b.addPart(new THREE.CylinderGeometry(r * 0.62, r * 0.78, h, 6, 1), 'frameGunmetal', {
    ...part, name: `${base || 'fixture'} bezel`, position: [p[0], p[1] - r - 0.002, p[2]],
  });
}
/** Emissive slab strip; p = [x,bottomY,z]. */
export function glow(b: KitbashBuilder, z: 'energyCyan' | 'warningAmber' | 'dangerCrimson', s: V3, p: V3, o: Opt = {}) {
  box(b, z, s, p, { name: 'glow strip light', r: 0.015, seg: 1, ...o });
}
/** Parabolic dish (double-sided shell). Centre of bowl rim at p; opens +Y before tilt. */
export function dish(b: KitbashBuilder, R: number, p: V3, tilt: number, o: Opt = {}) {
  const pts: THREE.Vector2[] = [];
  const n = 4, k = 0.55 / R, th = 0.04;
  for (let i = 0; i <= n; i++) { const r = Math.max(0.02, (R * i) / n); pts.push(new THREE.Vector2(r, k * r * r)); }
  for (let i = n; i >= 0; i--) { const r = Math.max(0.02, (R * i) / n); pts.push(new THREE.Vector2(r, k * r * r - th)); }
  const g = new THREE.LatheGeometry(pts, o.seg ?? 12);
  b.addPart(g, 'hullPrimary', { name: 'radar dish', ...o, position: p, rotation: [tilt, 0, 0] });
}
/** Octagonal foundation plinth (-0.1..0.2) with amber hazard trim. No corner lamps: each building lights its own fixtures. Returns top Y. */
export function plinth(b: KitbashBuilder, w: number, d: number, accent = true): number {
  box(b, 'frameGunmetal', [w, 0.3, d], [0, -0.1, 0], { name: 'foundation plinth', role: 'plinth', r: 0.1, seg: 1 });
  if (accent) {
    const iw = w - 0.3, id = d - 0.3, role = 'plinthDetail' as const;
    for (const s of [-1, 1]) {
      box(b, 'hullSecondary', [iw, 0.04, 0.1], [0, 0.18, s * id / 2], { name: 'plinth trim Z', role, r: 0.015, seg: 1 });
      box(b, 'hullSecondary', [0.1, 0.044, id - 0.1], [s * iw / 2, 0.182, 0], { name: 'plinth trim X', role, r: 0.015, seg: 1 });
    }
  }
  return 0.2;
}
/** 4-legged lattice tower from base half-size r0 to top half-size r1. */
export function lattice(b: KitbashBuilder, r0: number, r1: number, y0: number, y1: number, panels = 4, rail = 0.06, o: Opt = {}, cx = 0, cz = 0) {
  const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const at = (i: number, t: number): V3 => {
    const r = Math.max(0.02, r0 + (r1 - r0) * t);
    return [cx + c[i][0] * r, y0 + (y1 - y0) * t, cz + c[i][1] * r];
  };
  for (let i = 0; i < 4; i++) strut(b, 'frameGunmetal', at(i, 0), at(i, 1), rail, { name: 'lattice post', ...o });
  for (let k = 0; k < panels; k++) {
    const t0 = k / panels, t1 = (k + 1) / panels, dt = (t1 - t0) * 0.14;
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      strut(b, 'frameGunmetal', at(i, t0 + dt), at(j, t1 - dt), rail * 0.45, { name: 'lattice brace', ...o });
      strut(b, 'frameGunmetal', at(i, t1), at(j, t1), rail * 0.58, { name: 'lattice crossbar', ...o });
    }
  }
}
export function triCount(g: THREE.BufferGeometry) { return (g.index ? g.index.count : g.attributes.position.count) / 3; }
/** Part options for a rotor/blade spinning (animType 1) about a vertical axis through (x, z). */
export const spin = (x: number, z: number) => ({ animType: 1 as const, animPivot: [x, 0, z] as V3 });
