import * as THREE from 'three';
import type { Vec3 } from './spawnShell';
import type { ActiveWorkSiteInput } from './types';

const AZIMUTH_BINS = 72;
const BIN_ANGLE = (Math.PI * 2) / AZIMUTH_BINS;
const SURFACE_CLEARANCE_M = 0.03;
const CENTERLINE_HEIGHTS = [0.52, 0.36, 0.72, 0.22, 0.98] as const;
const UPPER_HEIGHTS = [1.28, 1.56] as const;
const LATERAL_OFFSETS = [0.28, -0.28, 0.58, -0.58, 0.95, -0.95, 1.35, -1.35] as const;
const ALL_SAMPLE_HEIGHTS = [...CENTERLINE_HEIGHTS, ...UPPER_HEIGHTS] as const;
const MAX_SPARK_FAN_RAD = (82 * Math.PI) / 180;

interface SurfaceBin {
  p: Vec3;
  r: number;
  d: number;
  populated: boolean;
}

export interface BuildingSurfaceProfile {
  readonly bins: SurfaceBin[];
  readonly maxRadius: number;
  readonly maxHeight: number;
}

const profileCache = new WeakMap<THREE.BufferGeometry, BuildingSurfaceProfile | null>();
const _invWorld = new THREE.Matrix4();
const _worldPt = new THREE.Vector3();
const _localPt = new THREE.Vector3();
const _originLocal = new THREE.Vector3();

interface LocalTriangle {
  ax: number; ay: number; az: number;
  bx: number; by: number; bz: number;
  cx: number; cy: number; cz: number;
  minY: number; maxY: number;
}

function extractBandTriangles(geo: THREE.BufferGeometry): { tris: LocalTriangle[]; maxHeight: number } {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!pos || pos.count < 3) return { tris: [], maxHeight: 0 };
  if (!geo.boundingBox) geo.computeBoundingBox();
  const maxHeight = geo.boundingBox ? Math.max(0.2, geo.boundingBox.max.y) : 1.8;

  const index = geo.index;
  const count = index ? index.count : pos.count;
  const tris: LocalTriangle[] = [];
  for (let i = 0; i + 2 < count; i += 3) {
    const i0 = index ? index.getX(i) : i;
    const i1 = index ? index.getX(i + 1) : i + 1;
    const i2 = index ? index.getX(i + 2) : i + 2;
    const ay = pos.getY(i0), by = pos.getY(i1), cy = pos.getY(i2);
    const minY = Math.min(ay, by, cy);
    const maxY = Math.max(ay, by, cy);
    if (maxY < 0.14 || minY > 1.76) continue;
    tris.push({
      ax: pos.getX(i0), ay, az: pos.getZ(i0),
      bx: pos.getX(i1), by, bz: pos.getZ(i1),
      cx: pos.getX(i2), cy, cz: pos.getZ(i2),
      minY, maxY,
    });
  }
  return { tris, maxHeight };
}

interface ProjectedTri {
  sA: number; yA: number; dA: number;
  sB: number; yB: number; dB: number;
  sC: number; yC: number; dC: number;
  minS: number; maxS: number;
  minY: number; maxY: number;
  maxD: number;
  tri: LocalTriangle;
}

function projectTrianglesForRay(tris: readonly LocalTriangle[], rx: number, rz: number, tx: number, tz: number): ProjectedTri[] {
  const projected: ProjectedTri[] = [];
  for (let i = 0; i < tris.length; i++) {
    const t = tris[i]!;
    const dA = t.ax * rx + t.az * rz;
    const dB = t.bx * rx + t.bz * rz;
    const dC = t.cx * rx + t.cz * rz;
    const maxD = Math.max(dA, dB, dC);
    if (maxD <= 0.05) continue;
    const sA = t.ax * tx + t.az * tz;
    const sB = t.bx * tx + t.bz * tz;
    const sC = t.cx * tx + t.cz * tz;
    const minS = Math.min(sA, sB, sC);
    const maxS = Math.max(sA, sB, sC);
    if (maxS < -1.36 || minS > 1.36) continue;
    projected.push({
      sA, yA: t.ay, dA, sB, yB: t.by, dB, sC, yC: t.cy, dC,
      minS, maxS, minY: t.minY, maxY: t.maxY, maxD, tri: t,
    });
  }
  return projected;
}

function probeProjectedTriangles(projected: readonly ProjectedTri[], lat: number, h: number): { p: Vec3; d: number } | null {
  let bestD = 0.05;
  let bestPoint: Vec3 | null = null;
  for (let i = 0; i < projected.length; i++) {
    const p = projected[i]!;
    if (p.maxD <= bestD || h < p.minY - 1e-4 || h > p.maxY + 1e-4 || lat < p.minS - 1e-4 || lat > p.maxS + 1e-4) continue;
    const denom = (p.yB - p.yC) * (p.sA - p.sC) + (p.sC - p.sB) * (p.yA - p.yC);
    if (Math.abs(denom) < 1e-8) continue;
    const wA = ((p.yB - p.yC) * (lat - p.sC) + (p.sC - p.sB) * (h - p.yC)) / denom;
    if (wA < -1e-4 || wA > 1 + 1e-4) continue;
    const wB = ((p.yC - p.yA) * (lat - p.sC) + (p.sA - p.sC) * (h - p.yC)) / denom;
    if (wB < -1e-4 || wB > 1 + 1e-4) continue;
    const wC = 1 - wA - wB;
    if (wC < -1e-4) continue;
    const d = wA * p.dA + wB * p.dB + wC * p.dC;
    if (d > bestD) {
      bestD = d;
      const t = p.tri;
      bestPoint = [
        wA * t.ax + wB * t.bx + wC * t.cx,
        wA * t.ay + wB * t.by + wC * t.cy,
        wA * t.az + wB * t.bz + wC * t.cz,
      ];
    }
  }
  return bestPoint ? { p: bestPoint, d: bestD } : null;
}

function bestProbeHit(
  projected: readonly ProjectedTri[],
  lats: readonly number[],
  heights: readonly number[],
): { p: Vec3; d: number } | null {
  let best: { p: Vec3; d: number } | null = null;
  for (const lat of lats) {
    for (const h of heights) {
      const hit = probeProjectedTriangles(projected, lat, h);
      if (hit && (!best || hit.d > best.d)) best = hit;
    }
  }
  return best;
}

function fillMissingBins(bins: SurfaceBin[], box: THREE.Box3 | null): void {
  const populatedIndices: number[] = [];
  for (let i = 0; i < bins.length; i++) if (bins[i]!.populated) populatedIndices.push(i);
  if (populatedIndices.length === 0) {
    const rx = box ? Math.max(0.25, (box.max.x - box.min.x) * 0.5) : 0.6;
    const rz = box ? Math.max(0.25, (box.max.z - box.min.z) * 0.5) : 0.6;
    const hy = box ? Math.min(0.65, Math.max(0.25, box.max.y * 0.35)) : 0.48;
    for (let i = 0; i < bins.length; i++) {
      const a = i * BIN_ANGLE;
      const px = Math.cos(a) * rx;
      const pz = Math.sin(a) * rz;
      bins[i] = { p: [px, hy, pz], r: Math.hypot(px, pz), d: Math.hypot(px, pz), populated: true };
    }
    return;
  }
  for (let i = 0; i < bins.length; i++) {
    if (bins[i]!.populated) continue;
    let prev = i, next = i, step = 1;
    while (step < bins.length) {
      const pIdx = (i - step + bins.length) % bins.length;
      if (bins[pIdx]!.populated) { prev = pIdx; break; }
      step++;
    }
    step = 1;
    while (step < bins.length) {
      const nIdx = (i + step) % bins.length;
      if (bins[nIdx]!.populated) { next = nIdx; break; }
      step++;
    }
    const a = bins[prev]!, b = bins[next]!;
    const p: Vec3 = [(a.p[0] + b.p[0]) * 0.5, (a.p[1] + b.p[1]) * 0.5, (a.p[2] + b.p[2]) * 0.5];
    bins[i] = { p, r: (a.r + b.r) * 0.5, d: (a.d + b.d) * 0.5, populated: true };
  }
}

/** Precomputes a cached 72-bin polar outer-surface profile for a building geometry. */
export function getBuildingSurfaceProfile(geo: THREE.BufferGeometry | null | undefined): BuildingSurfaceProfile | null {
  if (!geo) return null;
  if (profileCache.has(geo)) return profileCache.get(geo) ?? null;

  const { tris, maxHeight } = extractBandTriangles(geo);
  if (tris.length === 0) {
    profileCache.set(geo, null);
    return null;
  }

  const bins: SurfaceBin[] = [];
  for (let i = 0; i < AZIMUTH_BINS; i++) {
    const theta = i * BIN_ANGLE;
    const rx = Math.cos(theta), rz = Math.sin(theta);
    const tx = -rz, tz = rx;
    const projected = projectTrianglesForRay(tris, rx, rz, tx, tz);
    const hit =
      bestProbeHit(projected, [0], CENTERLINE_HEIGHTS) ??
      bestProbeHit(projected, [0], UPPER_HEIGHTS) ??
      bestProbeHit(projected, LATERAL_OFFSETS, ALL_SAMPLE_HEIGHTS);
    if (hit) {
      bins.push({ p: hit.p, r: Math.hypot(hit.p[0], hit.p[2]), d: hit.d, populated: true });
    } else {
      bins.push({ p: [0, 0.48, 0], r: 0, d: 0, populated: false });
    }
  }
  fillMissingBins(bins, geo.boundingBox);
  const maxRadius = bins.reduce((m, b) => Math.max(m, b.r), 0.5);
  const profile: BuildingSurfaceProfile = { bins, maxRadius, maxHeight };
  profileCache.set(geo, profile);
  return profile;
}

function sampleProfileAtAngle(profile: BuildingSurfaceProfile, theta: number): { p: Vec3; r: number; d: number } {
  const norm = ((theta % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const f = norm / BIN_ANGLE;
  const i0 = Math.floor(f) % AZIMUTH_BINS;
  const i1 = (i0 + 1) % AZIMUTH_BINS;
  const t = f - Math.floor(f);
  const a = profile.bins[i0]!;
  const b = profile.bins[i1]!;
  return {
    p: [
      a.p[0] + (b.p[0] - a.p[0]) * t,
      a.p[1] + (b.p[1] - a.p[1]) * t,
      a.p[2] + (b.p[2] - a.p[2]) * t,
    ],
    r: a.r + (b.r - a.r) * t,
    d: a.d + (b.d - a.d) * t,
  };
}

function resolveTargetMesh(raw: unknown): { obj: THREE.Object3D; geo: THREE.BufferGeometry | null } | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as THREE.Object3D;
  if (typeof obj.updateMatrixWorld !== 'function') return null;
  if ((obj as THREE.Mesh).isMesh && (obj as THREE.Mesh).geometry) {
    return { obj, geo: (obj as THREE.Mesh).geometry };
  }
  let foundGeo: THREE.BufferGeometry | null = null;
  obj.traverse?.((child) => {
    if (!foundGeo && (child as THREE.Mesh).isMesh && (child as THREE.Mesh).geometry) {
      foundGeo = (child as THREE.Mesh).geometry;
    }
  });
  return { obj, geo: foundGeo };
}

function referenceOrigin(site: ActiveWorkSiteInput): Vec3 {
  if (site.toolOrigins.length === 0) return site.botOrigin;
  let x = 0, y = 0, z = 0;
  for (const o of site.toolOrigins) { x += o[0]; y += o[1]; z += o[2]; }
  const inv = 1 / site.toolOrigins.length;
  return [x * inv, y * inv, z * inv];
}

function unitOutwardXZ(center: readonly [number, number, number], target: readonly [number, number, number], fallback: readonly [number, number, number]): [number, number] {
  let dx = target[0] - center[0];
  let dz = target[2] - center[2];
  let len = Math.hypot(dx, dz);
  if (len < 1e-4) {
    dx = fallback[0] - center[0];
    dz = fallback[2] - center[2];
    len = Math.hypot(dx, dz) || 1;
  }
  return [dx / len, dz / len];
}

function fallbackHullRadius(site: ActiveWorkSiteInput, geo: THREE.BufferGeometry | null): number {
  if (site.targetFootprintRadius !== undefined && site.targetFootprintRadius > 0) return site.targetFootprintRadius;
  if (geo) {
    if (!geo.boundingBox) geo.computeBoundingBox();
    if (geo.boundingBox) {
      const rx = (geo.boundingBox.max.x - geo.boundingBox.min.x) * 0.5;
      const rz = (geo.boundingBox.max.z - geo.boundingBox.min.z) * 0.5;
      if (rx > 0.05 || rz > 0.05) return Math.max(0.35, Math.min(rx, rz));
    }
  }
  return 0.9;
}

/** True when the active work site targets a 3D building/object surface rather than bare ground/props. */
export function hasSurfaceTarget(site: ActiveWorkSiteInput): boolean {
  return Boolean(
    site.targetMesh ||
      site.surfacePoint ||
      (site.targetFootprintRadius !== undefined && site.targetFootprintRadius > 0),
  );
}

/** Computes the welding impact point directly on the exterior 3D surface of a building mesh. */
export function computeSurfaceCutPoint(
  site: ActiveWorkSiteInput,
  sweepRadius: number,
  sweepFreq: number,
  clock: number,
  floor: number,
): Vec3 {
  const from = referenceOrigin(site);
  if (site.surfacePoint) {
    const [nx, nz] = unitOutwardXZ(site.targetPos, site.surfacePoint, from);
    const sweep = Math.sin(clock * sweepFreq) * Math.min(0.18, sweepRadius);
    return [
      site.surfacePoint[0] - nz * sweep,
      Math.max(floor, site.surfacePoint[1] + Math.sin(clock * sweepFreq * 1.37) * 0.05),
      site.surfacePoint[2] + nx * sweep,
    ];
  }

  const resolved = resolveTargetMesh(site.targetMesh);
  const profile = getBuildingSurfaceProfile(resolved?.geo);
  if (resolved && profile) {
    resolved.obj.updateMatrixWorld(true);
    _invWorld.copy(resolved.obj.matrixWorld).invert();
    _localPt.set(from[0], from[1], from[2]).applyMatrix4(_invWorld);
    const baseTheta = Math.atan2(_localPt.z, _localPt.x);
    const baseSample = sampleProfileAtAngle(profile, baseTheta);
    const maxArc = Math.min(0.22, sweepRadius / Math.max(0.6, baseSample.r));
    const sweepTheta = Math.sin(clock * sweepFreq) * maxArc;
    const sample = sampleProfileAtAngle(profile, baseTheta + sweepTheta);
    const localY = Math.max(0.15, sample.p[1] + Math.sin(clock * sweepFreq * 1.37) * 0.05);
    _worldPt.set(sample.p[0], localY, sample.p[2]).applyMatrix4(resolved.obj.matrixWorld);
    _originLocal.set(0, 0, 0).applyMatrix4(resolved.obj.matrixWorld);
    const [nx, nz] = unitOutwardXZ([_originLocal.x, _originLocal.y, _originLocal.z], [_worldPt.x, _worldPt.y, _worldPt.z], from);
    return [_worldPt.x + nx * SURFACE_CLEARANCE_M, Math.max(floor, _worldPt.y), _worldPt.z + nz * SURFACE_CLEARANCE_M];
  }

  const r = fallbackHullRadius(site, resolved?.geo ?? null);
  const [nx, nz] = unitOutwardXZ(site.targetPos, from, from);
  const sweep = Math.sin(clock * sweepFreq) * sweepRadius;
  const wy = Math.max(floor, site.targetPos[1] + Math.sin(clock * sweepFreq * 1.37) * 0.06);
  return [
    site.targetPos[0] + nx * (r + SURFACE_CLEARANCE_M) - nz * sweep,
    wy,
    site.targetPos[2] + nz * (r + SURFACE_CLEARANCE_M) + nx * sweep,
  ];
}

/** Computes a single laser beam's endpoint on the exterior 3D surface without piercing through corners. */
export function computeSurfaceBeamEnd(
  site: ActiveWorkSiteInput,
  origin: readonly [number, number, number],
  cutPoint: readonly [number, number, number],
  sideSign: number,
  floor: number,
): Vec3 {
  const [nx, nz] = unitOutwardXZ(site.targetPos, cutPoint, origin);
  const tx = -nz, tz = nx;
  const end: Vec3 = [
    cutPoint[0] + tx * sideSign * 0.035,
    Math.max(floor, cutPoint[1]),
    cutPoint[2] + tz * sideSign * 0.035,
  ];

  const resolved = resolveTargetMesh(site.targetMesh);
  const profile = getBuildingSurfaceProfile(resolved?.geo);
  if (!resolved || !profile) return end;

  resolved.obj.updateMatrixWorld(true);
  _invWorld.copy(resolved.obj.matrixWorld).invert();
  for (const t of [0.45, 0.65, 0.8, 0.92, 1.0]) {
    const wx = origin[0] + (end[0] - origin[0]) * t;
    const wy = origin[1] + (end[1] - origin[1]) * t;
    const wz = origin[2] + (end[2] - origin[2]) * t;
    _localPt.set(wx, wy, wz).applyMatrix4(_invWorld);
    if (_localPt.y < -0.05 || _localPt.y > profile.maxHeight + 0.1) continue;
    const theta = Math.atan2(_localPt.z, _localPt.x);
    const surf = sampleProfileAtAngle(profile, theta);
    const rLocal = Math.hypot(_localPt.x, _localPt.z);
    if (rLocal < surf.r + 0.015) {
      const pushR = surf.r + SURFACE_CLEARANCE_M;
      const scale = rLocal > 1e-4 ? pushR / rLocal : 1;
      _localPt.x = rLocal > 1e-4 ? _localPt.x * scale : Math.cos(theta) * pushR;
      _localPt.z = rLocal > 1e-4 ? _localPt.z * scale : Math.sin(theta) * pushR;
      _worldPt.copy(_localPt).applyMatrix4(resolved.obj.matrixWorld);
      return [_worldPt.x, Math.max(floor, _worldPt.y), _worldPt.z];
    }
  }
  return end;
}

/** Spawns a welding spark / debris particle on the outside of `cutPoint` bursting away from the wall. */
export function spawnSurfaceParticle(
  site: ActiveWorkSiteInput,
  cutPoint: readonly [number, number, number],
  rand: () => number,
  floor: number,
): { pos: Vec3; dirXZ: [number, number] } {
  const from = referenceOrigin(site);
  const [nx, nz] = unitOutwardXZ(site.targetPos, cutPoint, from);
  const tx = -nz, tz = nx;

  const outDist = 0.04 + rand() * 0.22;
  const tanDist = (rand() - 0.5) * 2 * 0.22;
  const yOff = (rand() - 0.5) * 2 * 0.18;

  const pos: Vec3 = [
    cutPoint[0] + nx * outDist + tx * tanDist,
    Math.max(floor, cutPoint[1] + yOff),
    cutPoint[2] + nz * outDist + tz * tanDist,
  ];
  const angle = (rand() - 0.5) * 2 * MAX_SPARK_FAN_RAD;
  const ca = Math.cos(angle), sa = Math.sin(angle);
  return { pos, dirXZ: [nx * ca - nz * sa, nx * sa + nz * ca] };
}

/** Keeps active welding particles on the exterior side of the tangent plane passing through `cutPoint`. */
export function clampOutsideSurface(
  site: ActiveWorkSiteInput,
  cutPoint: readonly [number, number, number],
  px: number,
  pz: number,
  vx: number,
  vz: number,
): { px: number; pz: number; vx: number; vz: number } {
  const [nx, nz] = unitOutwardXZ(site.targetPos, cutPoint, site.botOrigin);
  const dist = (px - cutPoint[0]) * nx + (pz - cutPoint[2]) * nz;
  if (dist >= 0.02) return { px, pz, vx, vz };
  const push = 0.02 - dist;
  const vn = vx * nx + vz * nz;
  return {
    px: px + nx * push,
    pz: pz + nz * push,
    vx: vn < 0 ? vx - 1.35 * vn * nx : vx,
    vz: vn < 0 ? vz - 1.35 * vn * nz : vz,
  };
}
