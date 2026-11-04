import * as THREE from 'three';

/** Grid state a cable shows: dark and still, sputtering amber, steady cyan pulses, or fast crimson arcs. */
export type CablePowerState = 'off' | 'brownout' | 'online' | 'overload' | 'demand';

/** Shader code of each state (`aCable.w`): `0` hides the arc overlay, the cable itself is always drawn. */
export const CABLE_STATE_CODE: Readonly<Record<CablePowerState, number>> = {
  off: 0,
  brownout: 1,
  online: 2,
  overload: 3,
  demand: 4,
};

/** One conductor between two anchors, in world space. Energy flows from `a` (upstream) to `b`. */
export interface CableSpan {
  a: readonly [number, number, number];
  b: readonly [number, number, number];
  /** Metres the middle of the span hangs below the straight line between `a` and `b`. */
  sag: number;
  /** Conductor radius in metres. */
  radius: number;
  state: CablePowerState;
  /** Stable 0..1 per span: de-synchronises the travelling pulses of neighbouring cables. */
  seed: number;
}

/** Ground height under a world point (metres); the builder keeps every cable point `CABLE_CLEARANCE_M` above it. */
export type GroundSampler = (x: number, z: number) => number;

export const CABLE_CLEARANCE_M = 0.45;
/** Rings per metre: the arc shader jitters each ring on its own, so this is also the jag length of the lightning. */
const RINGS_PER_M = 3;
const MIN_SEGMENTS = 6;
const MAX_SEGMENTS = 48;
/** Sides of the conductor tube (a square section reads as a round wire at RTS distance). */
const SIDES = 4;

/** Vertex range of one span inside the merged geometry (for in-place state updates). */
export interface CableSpanRange {
  start: number;
  count: number;
}

export interface CableGeometryResult {
  geometry: THREE.BufferGeometry;
  ranges: CableSpanRange[];
}

export function cableSegments(length: number): number {
  return Math.max(MIN_SEGMENTS, Math.min(MAX_SEGMENTS, Math.ceil(length * RINGS_PER_M)));
}

/** Point `t` (0..1) of a parabolic sag between `a` and `b`, lifted to clear the ground; written into `out`. */
export function cablePoint(span: CableSpan, t: number, out: THREE.Vector3, ground?: GroundSampler): THREE.Vector3 {
  const [ax, ay, az] = span.a;
  const [bx, by, bz] = span.b;
  out.set(ax + (bx - ax) * t, ay + (by - ay) * t - 4 * span.sag * t * (1 - t), az + (bz - az) * t);
  if (ground && t > 0 && t < 1) out.y = Math.max(out.y, ground(out.x, out.z) + CABLE_CLEARANCE_M);
  return out;
}

const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _tan = new THREE.Vector3();
const _side = new THREE.Vector3();
const _up = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

interface Buffers {
  pos: Float32Array;
  nrm: Float32Array;
  cable: Float32Array;
  side: Float32Array;
  idx: number[];
}

function writeSpan(span: CableSpan, buf: Buffers, vStart: number, ground?: GroundSampler): number {
  const len = Math.hypot(span.b[0] - span.a[0], span.b[1] - span.a[1], span.b[2] - span.a[2]);
  const segs = cableSegments(len);
  const state = CABLE_STATE_CODE[span.state];
  // Horizontal side vector of the whole span (stable even where the sag makes the tangent steep).
  _side.set(span.b[2] - span.a[2], 0, span.a[0] - span.b[0]);
  if (_side.lengthSq() < 1e-8) _side.set(1, 0, 0);
  _side.normalize();
  let v = vStart;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    cablePoint(span, t, _p, ground);
    if (i < segs) {
      cablePoint(span, (i + 1) / segs, _q, ground);
      _tan.subVectors(_q, _p).normalize();
    } else {
      cablePoint(span, (i - 1) / segs, _q, ground);
      _tan.subVectors(_p, _q).normalize();
    }
    _up.crossVectors(_side, _tan).normalize();
    if (_up.dot(UP) < 0) _up.negate();
    for (let k = 0; k < SIDES; k++) {
      const ang = (k / SIDES) * Math.PI * 2 + Math.PI / 4;
      const cx = Math.cos(ang), cy = Math.sin(ang);
      const nx = _side.x * cx + _up.x * cy, ny = _side.y * cx + _up.y * cy, nz = _side.z * cx + _up.z * cy;
      buf.pos.set([_p.x + nx * span.radius, _p.y + ny * span.radius, _p.z + nz * span.radius], v * 3);
      buf.nrm.set([nx, ny, nz], v * 3);
      buf.cable.set([t, len, span.seed, state], v * 4);
      buf.side.set([_side.x, _side.y, _side.z], v * 3);
      v++;
    }
    if (i === 0) continue;
    const r0 = vStart + (i - 1) * SIDES, r1 = vStart + i * SIDES;
    for (let k = 0; k < SIDES; k++) {
      const k1 = (k + 1) % SIDES;
      buf.idx.push(r0 + k, r1 + k, r1 + k1, r0 + k, r1 + k1, r0 + k1);
    }
  }
  return v - vStart;
}

/**
 * One merged geometry for every span: a thin `SIDES`-sided tube per conductor with a parabolic sag, plus the arc
 * shader's attributes `aCable` (t along the span 0..1 from upstream, span length m, seed, state code) and `aSide`
 * (the span's horizontal side vector). Built only when the grid's shape changes.
 */
export function buildCableGeometry(spans: readonly CableSpan[], ground?: GroundSampler): CableGeometryResult {
  let verts = 0;
  for (const s of spans) {
    const len = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1], s.b[2] - s.a[2]);
    verts += (cableSegments(len) + 1) * SIDES;
  }
  const buf: Buffers = {
    pos: new Float32Array(verts * 3),
    nrm: new Float32Array(verts * 3),
    cable: new Float32Array(verts * 4),
    side: new Float32Array(verts * 3),
    idx: [],
  };
  const ranges: CableSpanRange[] = [];
  let v = 0;
  for (const span of spans) {
    const count = writeSpan(span, buf, v, ground);
    ranges.push({ start: v, count });
    v += count;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(buf.pos, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(buf.nrm, 3));
  geometry.setAttribute('aCable', new THREE.BufferAttribute(buf.cable, 4));
  geometry.setAttribute('aSide', new THREE.BufferAttribute(buf.side, 3));
  geometry.setIndex(buf.idx);
  geometry.computeBoundingSphere();
  if (geometry.boundingSphere) geometry.boundingSphere.radius += 0.5; // arc jitter stays inside the cull sphere
  return { geometry, ranges };
}
