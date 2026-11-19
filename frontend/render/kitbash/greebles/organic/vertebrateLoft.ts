import * as THREE from 'three';
import { tissue, type Tissue } from './shapes';

export interface LoftStation {
  x?: number;
  y: number;
  z: number;
  rx: number;
  ryTop: number;
  ryBot: number;
  /** Cross-section fullness: >1 narrows top ridge/keel, <1 squares torso. */
  ridge?: number;
  /** Superellipse flattening (0..0.55): squares broad backs & flat bellies on heavy beasts. */
  squareness?: number;
  /** Directional fur-tuft radial relief along perimeter (0..0.022). */
  tuftAmp?: number;
}

export interface WingStation {
  x: number;
  y: number;
  z: number;
  chord: number;
  thick: number;
  camber: number;
  twist?: number;
}

export interface SculptedLoftOptions {
  /** Catmull-Rom subdivisions per station span (default 2 when stations >= 3). */
  subdiv?: number;
  /** Add rounded hemispherical dome rings at start/end so trunks never look flat-chopped. */
  domeCaps?: boolean;
}

function catmullScalar(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    2 * p1 +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

function clampSplineRadius(a: number, b: number, c: number): number {
  const lo = Math.min(a, b) * 0.76;
  const hi = Math.max(a, b) * 1.26;
  return Math.max(0.002, Math.min(hi, Math.max(lo, c)));
}

function interpolateStations(stations: readonly LoftStation[], subdiv: number): LoftStation[] {
  if (subdiv <= 1 || stations.length < 3) return [...stations];
  const n = stations.length;
  const out: LoftStation[] = [];
  for (let i = 0; i < n - 1; i++) {
    const s0 = stations[Math.max(0, i - 1)]!;
    const s1 = stations[i]!;
    const s2 = stations[i + 1]!;
    const s3 = stations[Math.min(n - 1, i + 2)]!;
    for (let k = 0; k < subdiv; k++) {
      const t = k / subdiv;
      if (t === 0) {
        out.push(s1);
        continue;
      }
      out.push({
        x: catmullScalar(s0.x ?? 0, s1.x ?? 0, s2.x ?? 0, s3.x ?? 0, t),
        y: catmullScalar(s0.y, s1.y, s2.y, s3.y, t),
        z: catmullScalar(s0.z, s1.z, s2.z, s3.z, t),
        rx: clampSplineRadius(s1.rx, s2.rx, catmullScalar(s0.rx, s1.rx, s2.rx, s3.rx, t)),
        ryTop: clampSplineRadius(s1.ryTop, s2.ryTop, catmullScalar(s0.ryTop, s1.ryTop, s2.ryTop, s3.ryTop, t)),
        ryBot: clampSplineRadius(s1.ryBot, s2.ryBot, catmullScalar(s0.ryBot, s1.ryBot, s2.ryBot, s3.ryBot, t)),
        ridge: THREE.MathUtils.lerp(s1.ridge ?? 0, s2.ridge ?? 0, t),
        squareness: THREE.MathUtils.lerp(s1.squareness ?? 0, s2.squareness ?? 0, t),
        tuftAmp: THREE.MathUtils.lerp(s1.tuftAmp ?? 0, s2.tuftAmp ?? 0, t),
      });
    }
  }
  out.push(stations[n - 1]!);
  return out;
}

function withDomeCaps(stations: LoftStation[]): { rings: LoftStation[]; startCapOffset: [number, number, number]; endCapOffset: [number, number, number] } {
  const first = stations[0]!;
  const second = stations[1] ?? first;
  const last = stations[stations.length - 1]!;
  const prev = stations[stations.length - 2] ?? last;

  const sDir = new THREE.Vector3((first.x ?? 0) - (second.x ?? 0), first.y - second.y, first.z - second.z);
  if (sDir.lengthSq() < 1e-6) sDir.set(0, 0, -1);
  sDir.normalize();
  const sCap = Math.min(first.rx, Math.max(first.ryTop, first.ryBot)) * 0.36;

  const eDir = new THREE.Vector3((last.x ?? 0) - (prev.x ?? 0), last.y - prev.y, last.z - prev.z);
  if (eDir.lengthSq() < 1e-6) eDir.set(0, 0, 1);
  eDir.normalize();
  const eCap = Math.min(last.rx, Math.max(last.ryTop, last.ryBot)) * 0.36;

  const scaleStation = (st: LoftStation, dir: THREE.Vector3, dist: number, s: number): LoftStation => ({
    x: (st.x ?? 0) + dir.x * dist,
    y: st.y + dir.y * dist,
    z: st.z + dir.z * dist,
    rx: Math.max(0.002, st.rx * s),
    ryTop: Math.max(0.002, st.ryTop * s),
    ryBot: Math.max(0.002, st.ryBot * s),
    ridge: (st.ridge ?? 0) * s,
    squareness: (st.squareness ?? 0) * s,
    tuftAmp: (st.tuftAmp ?? 0) * s,
  });

  const rings = [
    scaleStation(first, sDir, sCap * 0.80, 0.44),
    scaleStation(first, sDir, sCap * 0.42, 0.78),
    ...stations,
    scaleStation(last, eDir, eCap * 0.42, 0.78),
    scaleStation(last, eDir, eCap * 0.80, 0.44),
  ];
  return {
    rings,
    startCapOffset: [(first.x ?? 0) + sDir.x * sCap, first.y + sDir.y * sCap, first.z + sDir.z * sCap],
    endCapOffset: [(last.x ?? 0) + eDir.x * eCap, last.y + eDir.y * eCap, last.z + eDir.z * eCap],
  };
}

/** Average normals across the UV wrap seam (`i = 0` and `i = sides`) so curved spines & limbs shade seamlessly. */
function smoothSeamNormals(g: THREE.BufferGeometry, ringCount: number, ringStride: number): void {
  const norm = g.attributes.normal as THREE.BufferAttribute;
  const n0 = new THREE.Vector3();
  const n1 = new THREE.Vector3();
  for (let r = 0; r < ringCount; r++) {
    const a = r * ringStride;
    const b = a + ringStride - 1;
    n0.fromBufferAttribute(norm, a);
    n1.fromBufferAttribute(norm, b);
    n0.add(n1);
    if (n0.lengthSq() > 1e-8) n0.normalize();
    else n0.set(0, 1, 0);
    norm.setXYZ(a, n0.x, n0.y, n0.z);
    norm.setXYZ(b, n0.x, n0.y, n0.z);
  }
  norm.needsUpdate = true;
}

function buildRingVertices(
  st: LoftStation,
  radialSides: number,
  v: number,
  seed: number,
  ribs: number,
  positions: number[],
  uvs: number[],
): void {
  const cx = st.x ?? 0;
  const ridge = st.ridge ?? 0;
  const sq = Math.max(0, Math.min(0.55, st.squareness ?? 0));
  const shapeExp = 1 - 0.42 * sq;
  const tAmp = st.tuftAmp ?? 0;
  const band = ribs > 0 ? 1 + ribs * Math.cos(v * Math.PI * 5 + seed) * Math.sin(v * Math.PI) : 1;
  for (let i = 0; i <= radialSides; i++) {
    const a = (i / radialSides) * Math.PI * 2;
    const rawCa = Math.cos(a);
    const rawSa = Math.sin(a);
    const ca = sq > 0 ? Math.sign(rawCa) * Math.pow(Math.abs(rawCa), shapeExp) : rawCa;
    const sa = sq > 0 ? Math.sign(rawSa) * Math.pow(Math.abs(rawSa), shapeExp) : rawSa;
    const ry = sa >= 0 ? st.ryTop : st.ryBot;
    const pinch = sa > 0 ? 1 - ridge * sa * 0.28 : 1 - ridge * (-sa) * 0.14;
    const tuft = tAmp > 0 ? tAmp * (0.58 * Math.cos(a * 5 + v * 11 + seed) + 0.42 * Math.sin(a * 7 - v * 9)) : 0;
    const x = cx + ca * (st.rx * band * pinch + tuft);
    const y = st.y + sa * (ry * band + tuft);
    positions.push(x, y, st.z);
    uvs.push(i / radialSides, v);
  }
}

/**
 * Closed watertight anatomical loft across arbitrary cross-section stations along the spine or limb axis.
 * Uses Catmull-Rom subdivision, rounded dome endcaps, and seam-averaged vertex normals for organic smoothness.
 */
export function sculptedLoft(
  stations: readonly LoftStation[],
  radialSides = 14,
  kind: Tissue = 6,
  seed = 0,
  ribs = 0,
  options: SculptedLoftOptions = {},
): THREE.BufferGeometry {
  const subdiv = options.subdiv ?? 2;
  const domeCaps = options.domeCaps ?? true;
  const smooth = interpolateStations(stations, subdiv);
  const { rings, startCapOffset, endCapOffset } = domeCaps
    ? withDomeCaps(smooth)
    : {
        rings: smooth,
        startCapOffset: [smooth[0]!.x ?? 0, smooth[0]!.y, smooth[0]!.z] as [number, number, number],
        endCapOffset: [smooth[smooth.length - 1]!.x ?? 0, smooth[smooth.length - 1]!.y, smooth[smooth.length - 1]!.z] as [number, number, number],
      };

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const ringStride = radialSides + 1;
  const n = rings.length;

  for (let k = 0; k < n; k++) {
    buildRingVertices(rings[k]!, radialSides, k / Math.max(1, n - 1), seed, ribs, positions, uvs);
  }
  for (let k = 0; k < n - 1; k++) {
    const rowA = k * ringStride;
    const rowB = (k + 1) * ringStride;
    for (let i = 0; i < radialSides; i++) {
      const a0 = rowA + i, a1 = rowA + i + 1, b0 = rowB + i, b1 = rowB + i + 1;
      indices.push(a0, a1, b0, a1, b1, b0);
    }
  }

  const startCenter = positions.length / 3;
  positions.push(...startCapOffset);
  uvs.push(0.5, 0);
  const endCenter = positions.length / 3;
  positions.push(...endCapOffset);
  uvs.push(0.5, 1);

  const lastRow = (n - 1) * ringStride;
  for (let i = 0; i < radialSides; i++) {
    indices.push(startCenter, i + 1, i);
    indices.push(endCenter, lastRow + i, lastRow + i + 1);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  smoothSeamNormals(g, n, ringStride);
  return tissue(g, kind);
}

/**
 * Watertight tapered muscular limb segment along arbitrary 3D centerline points `[x, y, z]` with
 * independent lateral (`rx`) and sagittal (`rz`) radii, rounded muscle caps, and seamless normals.
 */
export function sculptedLimbSegment(
  points: readonly [number, number, number][],
  rxList: readonly number[],
  rzList: readonly number[],
  sides = 10,
  kind: Tissue = 6,
): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  const segs = Math.max(4, points.length + 1);
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const ringStride = sides + 1;
  const sideAxis = new THREE.Vector3(1, 0, 0);
  const fwdAxis = new THREE.Vector3();

  const sampleList = (arr: readonly number[], t: number) => {
    const f = t * (arr.length - 1);
    const k = Math.min(Math.floor(f), arr.length - 2);
    return THREE.MathUtils.lerp(arr[k]!, arr[k + 1]!, f - k);
  };
  const pushRing = (c: THREE.Vector3, tan: THREE.Vector3, rx: number, rz: number, v: number) => {
    fwdAxis.crossVectors(sideAxis, tan);
    if (fwdAxis.lengthSq() < 1e-5) fwdAxis.set(0, 0, 1);
    else fwdAxis.normalize();
    const latAxis = new THREE.Vector3().crossVectors(tan, fwdAxis).normalize();
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      const pt = c.clone().addScaledVector(latAxis, Math.cos(a) * rx).addScaledVector(fwdAxis, Math.sin(a) * rz);
      pos.push(pt.x, pt.y, pt.z);
      uv.push(i / sides, v);
    }
  };

  const c0 = curve.getPoint(0), t0 = curve.getTangent(0).normalize();
  const rx0 = sampleList(rxList, 0), rz0 = sampleList(rzList, 0);
  const cap0 = Math.min(rx0, rz0) * 0.86;
  pushRing(c0.clone().addScaledVector(t0, -cap0 * 0.78), t0, rx0 * 0.54, rz0 * 0.54, 0);
  pushRing(c0.clone().addScaledVector(t0, -cap0 * 0.40), t0, rx0 * 0.88, rz0 * 0.88, 0);

  for (let j = 0; j <= segs; j++) {
    const t = j / segs;
    pushRing(curve.getPoint(t), curve.getTangent(t).normalize(), sampleList(rxList, t), sampleList(rzList, t), t);
  }

  const c1 = curve.getPoint(1), t1 = curve.getTangent(1).normalize();
  const rx1 = sampleList(rxList, 1), rz1 = sampleList(rzList, 1);
  const cap1 = Math.min(rx1, rz1) * 0.86;
  pushRing(c1.clone().addScaledVector(t1, cap1 * 0.40), t1, rx1 * 0.88, rz1 * 0.88, 1);
  pushRing(c1.clone().addScaledVector(t1, cap1 * 0.78), t1, rx1 * 0.54, rz1 * 0.54, 1);

  const totalRings = segs + 5;
  for (let j = 0; j < totalRings - 1; j++) {
    const rA = j * ringStride, rB = (j + 1) * ringStride;
    for (let i = 0; i < sides; i++) idx.push(rA + i, rB + i, rA + i + 1, rA + i + 1, rB + i, rB + i + 1);
  }

  const i0 = pos.length / 3;
  const pStart = c0.clone().addScaledVector(t0, -cap0);
  pos.push(pStart.x, pStart.y, pStart.z); uv.push(0.5, 0);
  const i1 = pos.length / 3;
  const pEnd = c1.clone().addScaledVector(t1, cap1);
  pos.push(pEnd.x, pEnd.y, pEnd.z); uv.push(0.5, 1);
  const rLast = (totalRings - 1) * ringStride;
  for (let i = 0; i < sides; i++) {
    idx.push(i0, i, i + 1);
    idx.push(i1, rLast + i + 1, rLast + i);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  smoothSeamNormals(g, totalRings, ringStride);
  return tissue(g, kind);
}

function interpolateWingStations(stations: readonly WingStation[], subdiv = 2): WingStation[] {
  if (subdiv <= 1 || stations.length < 3) return [...stations];
  const n = stations.length;
  const out: WingStation[] = [];
  for (let i = 0; i < n - 1; i++) {
    const s0 = stations[Math.max(0, i - 1)]!;
    const s1 = stations[i]!;
    const s2 = stations[i + 1]!;
    const s3 = stations[Math.min(n - 1, i + 2)]!;
    for (let k = 0; k < subdiv; k++) {
      const t = k / subdiv;
      if (t === 0) { out.push(s1); continue; }
      out.push({
        x: catmullScalar(s0.x, s1.x, s2.x, s3.x, t),
        y: catmullScalar(s0.y, s1.y, s2.y, s3.y, t),
        z: catmullScalar(s0.z, s1.z, s2.z, s3.z, t),
        chord: clampSplineRadius(s1.chord, s2.chord, catmullScalar(s0.chord, s1.chord, s2.chord, s3.chord, t)),
        thick: clampSplineRadius(s1.thick, s2.thick, catmullScalar(s0.thick, s1.thick, s2.thick, s3.thick, t)),
        camber: THREE.MathUtils.lerp(s1.camber, s2.camber, t),
        twist: THREE.MathUtils.lerp(s1.twist ?? 0, s2.twist ?? 0, t),
      });
    }
  }
  out.push(stations[n - 1]!);
  return out;
}

/**
 * Watertight cambered airfoil wing loft along span stations `(x, y, z)` for authentic bird wings.
 */
export function sculptedWingFoil(
  rawStations: readonly WingStation[],
  chordSegs = 10,
  kind: Tissue = 7,
  subdiv = 2,
): THREE.BufferGeometry {
  const stations = interpolateWingStations(rawStations, subdiv);
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const ringStride = chordSegs + 1;
  const n = stations.length;
  const spanSign = stations[n - 1]!.x >= stations[0]!.x ? 1 : -1;

  for (let k = 0; k < n; k++) {
    const st = stations[k]!;
    const v = k / Math.max(1, n - 1);
    const twist = st.twist ?? 0;
    const ct = Math.cos(twist), stw = Math.sin(twist);
    for (let i = 0; i <= chordSegs; i++) {
      const theta = (i / chordSegs) * Math.PI * 2;
      const s = 0.5 - 0.5 * Math.cos(theta);
      const upper = Math.sin(theta) >= 0 ? 1 : -1;
      const halfT = st.thick * (0.2969 * Math.sqrt(Math.max(0.001, s)) - 0.126 * s - 0.3516 * s * s + 0.2843 * s * s * s - 0.1015 * s * s * s * s) + 0.002;
      const cam = st.camber * 4 * s * (1 - s);
      const localZ = (0.30 - s) * st.chord;
      const localY = cam + upper * Math.max(0.002, halfT);
      pos.push(st.x, st.y + localZ * stw + localY * ct, st.z + localZ * ct - localY * stw);
      uv.push(s, v);
    }
  }

  for (let k = 0; k < n - 1; k++) {
    const rA = k * ringStride, rB = (k + 1) * ringStride;
    for (let i = 0; i < chordSegs; i++) {
      if (spanSign > 0) idx.push(rA + i, rB + i, rA + i + 1, rA + i + 1, rB + i, rB + i + 1);
      else idx.push(rA + i, rA + i + 1, rB + i, rA + i + 1, rB + i + 1, rB + i);
    }
  }

  const first = stations[0]!, last = stations[n - 1]!;
  const c0 = pos.length / 3;
  pos.push(first.x, first.y, first.z - first.chord * 0.2); uv.push(0.5, 0);
  const c1 = pos.length / 3;
  pos.push(last.x + spanSign * 0.008, last.y, last.z - last.chord * 0.25); uv.push(0.5, 1);
  const rLast = (n - 1) * ringStride;
  for (let i = 0; i < chordSegs; i++) {
    if (spanSign > 0) { idx.push(c0, i, i + 1); idx.push(c1, rLast + i + 1, rLast + i); }
    else { idx.push(c0, i + 1, i); idx.push(c1, rLast + i, rLast + i + 1); }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  smoothSeamNormals(g, n, ringStride);
  return tissue(g, kind);
}

/** Watertight sculpted 3D feather blade with arched camber and smoothly rounded vane tip. */
export function sculptedFeather(
  length: number,
  width: number,
  thick = 0.008,
  camber = 0.012,
  kind: Tissue = 7,
): THREE.BufferGeometry {
  const stations: LoftStation[] = [
    { y: 0, z: 0, rx: width * 0.40, ryTop: thick * 0.72, ryBot: thick * 0.55 },
    { y: camber * 0.75, z: -length * 0.34, rx: width * 0.54, ryTop: thick * 0.95, ryBot: thick * 0.46 },
    { y: camber * 0.90, z: -length * 0.72, rx: width * 0.46, ryTop: thick * 0.78, ryBot: thick * 0.40 },
    { y: camber * 0.25, z: -length, rx: width * 0.16, ryTop: thick * 0.40, ryBot: thick * 0.30 },
  ];
  return sculptedLoft(stations.slice().reverse(), 6, kind, 0, 0, { subdiv: 1, domeCaps: false });
}

/** Watertight cupped mammalian ear pinna (broad base, concave inner face, rounded/pointed tip). */
export function sculptedEar(
  width: number,
  height: number,
  thick: number,
  side: number,
  pointiness = 0.85,
  kind: Tissue = 6,
): THREE.BufferGeometry {
  const tipScale = 1 - pointiness * 0.72;
  const g = sculptedLoft(
    [
      { x: 0, y: 0, z: 0, rx: width * 0.58, ryTop: thick * 0.68, ryBot: thick * 0.68 },
      { x: side * width * 0.08, y: thick * 0.26, z: height * 0.42, rx: width * 0.60, ryTop: thick * 0.56, ryBot: thick * 0.36 },
      { x: side * width * 0.12, y: thick * 0.14, z: height * 0.78, rx: width * 0.38 * (0.4 + 0.6 * tipScale), ryTop: thick * 0.40, ryBot: thick * 0.28 },
      { x: side * width * 0.10, y: 0, z: height, rx: Math.max(0.005, width * 0.16 * tipScale), ryTop: thick * 0.26, ryBot: thick * 0.26 },
    ],
    6,
    kind,
    side,
    0,
    { subdiv: 1, domeCaps: false },
  );
  g.rotateX(-Math.PI / 2);
  g.rotateZ(-side * 0.16);
  g.computeVertexNormals();
  return tissue(g, kind);
}
