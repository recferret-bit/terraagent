import * as THREE from 'three';
import { KitbashBuilder, KitbashRegistry, type MaterialZoneId } from '../KitbashRegistry';
import { cyl, type V3 } from './unitParts';

class ChamferBoxGeometry extends THREE.BufferGeometry {
  override readonly type = 'ChamferBoxGeometry';
}

class ChamferPlateGeometry extends THREE.BufferGeometry {
  override readonly type = 'ChamferPlateGeometry';
}

/**
 * Watertight 12-edge + 8-corner 45° chamfered structural hull block (`44` tris vs `108` for `RoundedBoxGeometry(seg=1)`).
 * Exact `[w, h, d]` outer bounds centered at origin so beveled hull edges catch IBL specular highlights cleanly.
 */
export function chamferBox(w: number, h: number, d: number, bevel = 0.12): THREE.BufferGeometry {
  const b = Math.max(0, Math.min(bevel, w * 0.24, h * 0.24, d * 0.24));
  const x = w * 0.5,
    y = h * 0.5,
    z = d * 0.5;
  const ix = x - b,
    iy = y - b,
    iz = z - b;
  const verts: number[] = [];
  const tri = (a: V3, c: V3, e: V3) => {
    verts.push(...a, ...c, ...e);
  };
  const quad = (p0: V3, p1: V3, p2: V3, p3: V3) => {
    tri(p0, p1, p2);
    tri(p0, p2, p3);
  };
  const vx = (sx: number, sy: number, sz: number): V3 => [sx * x, sy * iy, sz * iz];
  const vy = (sx: number, sy: number, sz: number): V3 => [sx * ix, sy * y, sz * iz];
  const vz = (sx: number, sy: number, sz: number): V3 => [sx * ix, sy * iy, sz * z];

  quad(vz(-1, -1, 1), vz(1, -1, 1), vz(1, 1, 1), vz(-1, 1, 1));
  quad(vz(1, -1, -1), vz(-1, -1, -1), vz(-1, 1, -1), vz(1, 1, -1));
  quad(vx(1, -1, 1), vx(1, -1, -1), vx(1, 1, -1), vx(1, 1, 1));
  quad(vx(-1, -1, -1), vx(-1, -1, 1), vx(-1, 1, 1), vx(-1, 1, -1));
  quad(vy(-1, 1, 1), vy(1, 1, 1), vy(1, 1, -1), vy(-1, 1, -1));
  quad(vy(-1, -1, -1), vy(1, -1, -1), vy(1, -1, 1), vy(-1, -1, 1));

  quad(vx(1, 1, 1), vx(1, 1, -1), vy(1, 1, -1), vy(1, 1, 1));
  quad(vy(-1, 1, 1), vy(-1, 1, -1), vx(-1, 1, -1), vx(-1, 1, 1));
  quad(vy(1, -1, 1), vy(1, -1, -1), vx(1, -1, -1), vx(1, -1, 1));
  quad(vx(-1, -1, 1), vx(-1, -1, -1), vy(-1, -1, -1), vy(-1, -1, 1));

  quad(vz(-1, 1, 1), vz(1, 1, 1), vy(1, 1, 1), vy(-1, 1, 1));
  quad(vy(-1, 1, -1), vy(1, 1, -1), vz(1, 1, -1), vz(-1, 1, -1));
  quad(vy(-1, -1, 1), vy(1, -1, 1), vz(1, -1, 1), vz(-1, -1, 1));
  quad(vz(-1, -1, -1), vz(1, -1, -1), vy(1, -1, -1), vy(-1, -1, -1));

  quad(vz(1, -1, 1), vx(1, -1, 1), vx(1, 1, 1), vz(1, 1, 1));
  quad(vx(1, -1, -1), vz(1, -1, -1), vz(1, 1, -1), vx(1, 1, -1));
  quad(vx(-1, -1, 1), vz(-1, -1, 1), vz(-1, 1, 1), vx(-1, 1, 1));
  quad(vz(-1, -1, -1), vx(-1, -1, -1), vx(-1, 1, -1), vz(-1, 1, -1));

  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        if (sx * sy * sz > 0) tri(vx(sx, sy, sz), vy(sx, sy, sz), vz(sx, sy, sz));
        else tri(vx(sx, sy, sz), vz(sx, sy, sz), vy(sx, sy, sz));
      }
    }
  }
  const g = new ChamferBoxGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  const uvs = new Float32Array((verts.length / 3) * 2);
  for (let i = 0, j = 0; i < verts.length; i += 3, j += 2) {
    uvs[j] = verts[i]! / Math.max(1e-4, w) + 0.5;
    uvs[j + 1] = verts[i + 2]! / Math.max(1e-4, d) + 0.5;
  }
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  return g;
}

/**
 * Watertight 12-triangle beveled structural plate/frame/rib (`ChamferPlateGeometry`, exact `[w, h, d]` outer bounds).
 * Slopes the 4 perimeter walls inward toward the proud face so edges catch specular highlights at zero extra triangles.
 */
export function bevelSlab(
  w: number,
  h: number,
  d: number,
  bevel = 0.06,
  axis: 'x' | 'y' | 'z' = 'y',
  dir: 1 | -1 = 1,
): THREE.BufferGeometry {
  const x = w * 0.5,
    y = h * 0.5,
    z = d * 0.5;
  const tx = axis === 'x' ? 0 : Math.max(0, Math.min(bevel, x * 0.3));
  const ty = axis === 'y' ? 0 : Math.max(0, Math.min(bevel, y * 0.3));
  const tz = axis === 'z' ? 0 : Math.max(0, Math.min(bevel, z * 0.3));
  const pt = (sx: number, sy: number, sz: number): V3 => {
    const posSide = (axis === 'y' && sy * dir > 0) || (axis === 'z' && sz * dir > 0) || (axis === 'x' && sx * dir > 0);
    return [sx * (posSide ? x - tx : x), sy * (posSide ? y - ty : y), sz * (posSide ? z - tz : z)];
  };
  const verts: number[] = [];
  const quad = (a: V3, b: V3, c: V3, e: V3) => {
    verts.push(...a, ...b, ...c, ...a, ...c, ...e);
  };
  quad(pt(-1, -1, 1), pt(1, -1, 1), pt(1, 1, 1), pt(-1, 1, 1));
  quad(pt(1, -1, -1), pt(-1, -1, -1), pt(-1, 1, -1), pt(1, 1, -1));
  quad(pt(1, -1, 1), pt(1, -1, -1), pt(1, 1, -1), pt(1, 1, 1));
  quad(pt(-1, -1, -1), pt(-1, -1, 1), pt(-1, 1, 1), pt(-1, 1, -1));
  quad(pt(-1, 1, 1), pt(1, 1, 1), pt(1, 1, -1), pt(-1, 1, -1));
  quad(pt(-1, -1, -1), pt(1, -1, -1), pt(1, -1, 1), pt(-1, -1, 1));
  const g = new ChamferPlateGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  const uvs = new Float32Array((verts.length / 3) * 2);
  for (let i = 0, j = 0; i < verts.length; i += 3, j += 2) {
    uvs[j] = verts[i]! / Math.max(1e-4, w) + 0.5;
    uvs[j + 1] = verts[i + 2]! / Math.max(1e-4, d) + 0.5;
  }
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  return g;
}

export function makePlacer(origin: V3, rotation: V3 = [0, 0, 0]) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation));
  const place = (local: V3): V3 => {
    const v = new THREE.Vector3(...local).applyQuaternion(q);
    return [origin[0] + v.x, origin[1] + v.y, origin[2] + v.z];
  };
  const composeRot = (localEuler: V3): V3 => {
    const lq = new THREE.Quaternion().setFromEuler(new THREE.Euler(...localEuler));
    const cq = q.clone().multiply(lq);
    const e = new THREE.Euler().setFromQuaternion(cq);
    return [e.x, e.y, e.z];
  };
  return { place, composeRot };
}

export interface OrbitalSolarWingOpts {
  position: V3;
  rotation?: V3;
  /** Span along local X. */
  span: number;
  /** Chord along local Z. */
  chord: number;
  /** Frame thickness along local Y. */
  thickness?: number;
  cols?: number;
  rows?: number;
  busZone?: MaterialZoneId;
  ribZone?: MaterialZoneId;
  tipSide?: 1 | -1;
  tipGlowZone?: MaterialZoneId;
  name?: string;
}

/**
 * Multi-cell orbital photovoltaic wing: gunmetal structural frame, `cols x rows` separate `solarCell` tiles
 * (`<= 2.0 cm` seam gap so `model-geometry-validator` groups them as one panel), proud metallic bus bars
 * for long-range orbital readability, underside structural ribs, and optional wingtip strobe cap.
 */
export function orbitalSolarWing(b: KitbashBuilder, opts: OrbitalSolarWingOpts): void {
  const {
    position,
    rotation = [0, 0, 0],
    span,
    chord,
    thickness = 0.28,
    cols = 4,
    rows = 2,
    busZone = 'hullPrimary',
    ribZone = 'hullSecondary',
    tipSide,
    tipGlowZone = 'energyCyan',
    name = 'orbital',
  } = opts;
  const { place, composeRot } = makePlacer(position, rotation);
  const t2 = thickness / 2;
  const marginX = Math.max(0.18, span * 0.032);
  const marginZ = Math.max(0.16, chord * 0.04);
  const gap = 0.018;

  b.addPart(bevelSlab(span, thickness, chord, 0.06), 'frameGunmetal', {
    name: `${name} solar wing frame`,
    position,
    rotation,
  });

  const cw = (span - 2 * marginX - (cols - 1) * gap) / cols;
  const cd = (chord - 2 * marginZ - (rows - 1) * gap) / rows;
  // Bifacial orbital photovoltaic cells: stand proud of BOTH `+Y` and `-Y` frame faces at zero extra triangles!
  const cellH = thickness + 0.028;

  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const lx = -span / 2 + marginX + cw / 2 + c * (cw + gap);
      const lz = -chord / 2 + marginZ + cd / 2 + r * (cd + gap);
      b.addPart(bevelSlab(cw, cellH, cd, 0.014, 'y', 1), 'solarCell', {
        name: `${name} solar cell`,
        position: place([lx, 0, lz]),
        rotation,
      });
    }
  }

  const barW = Math.max(0.1, span * 0.014);
  for (let c = 1; c < cols; c++) {
    const lx = -span / 2 + marginX + c * (cw + gap) - gap / 2;
    b.addPart(bevelSlab(barW, 0.038, chord - 2 * marginZ + 0.04, 0.012, 'y', 1), busZone, {
      name: `${name} solar bus bar`,
      position: place([lx, t2 + 0.034, 0]),
      rotation,
    });
  }

  const ribH = Math.max(0.12, thickness * 0.5);
  for (const zFrac of [-0.27, 0.27]) {
    b.addPart(bevelSlab(span * 0.9, ribH, Math.max(0.14, chord * 0.048), 0.03, 'y', -1), ribZone, {
      name: `${name} solar wing rib`,
      position: place([0, -t2 - ribH * 0.42, chord * zFrac]),
      rotation,
    });
  }

  if (tipSide) {
    const capW = Math.max(0.28, span * 0.035);
    const capX = tipSide * (span / 2 + capW * 0.28);
    b.addPart(bevelSlab(capW, thickness * 1.32, chord * 0.88, 0.05, 'x', tipSide), ribZone, {
      name: `${name} wing tip cap`,
      position: place([capX, 0, 0]),
      rotation,
    });
    b.addPart(bevelSlab(capW * 0.55, thickness * 0.72, chord * 0.68, 0.03, 'x', tipSide), tipGlowZone, {
      name: `${name} wing tip strobe light`,
      position: place([capX + tipSide * capW * 0.42, 0, 0]),
      rotation: composeRot([0, 0, 0]),
      emissiveIntensity: 3.9,
    });
  }
}

export interface RadiatorLouvreOpts {
  position: V3;
  rotation?: V3;
  width: number;
  height: number;
  depth?: number;
  slats?: number;
  slatZone?: MaterialZoneId;
  name?: string;
}

/** Thermal radiator grille with `>= 4` proud angled slats (passes `ventRule` and breaks large hull faces). */
export function radiatorLouvreBank(b: KitbashBuilder, opts: RadiatorLouvreOpts): void {
  const {
    position,
    rotation = [0, 0, 0],
    width,
    height,
    depth = 0.24,
    slats = 4,
    slatZone = 'hullSecondary',
    name = 'hull',
  } = opts;
  const { place, composeRot } = makePlacer(position, rotation);
  b.addPart(bevelSlab(width, height, depth, 0.05), 'frameGunmetal', {
    name: `${name} radiator vent`,
    position,
    rotation,
  });
  const count = Math.max(3, slats);
  const margin = height * 0.15;
  const step = (height - 2 * margin) / Math.max(1, count - 1);
  const slatT = Math.max(0.04, height * 0.09);
  for (let i = 0; i < count; i++) {
    const ly = -height / 2 + margin + i * step;
    b.addPart(bevelSlab(width * 0.86, slatT, depth * 0.58, 0.015, 'z', 1), slatZone, {
      name: `${name} cooling slat`,
      position: place([0, ly, depth * 0.38]),
      rotation: composeRot([0.22, 0, 0]),
    });
  }
}

export interface AngledDropPodCradleOpts {
  position: V3;
  /** Local `-Y` aims the pod heat-shield nose toward the planet drop vector. */
  rotation?: V3;
  scale?: number;
  podZone?: MaterialZoneId;
  glowZone?: MaterialZoneId;
  name?: string;
}

/**
 * Planet-oriented orbital drop-pod launch cradle: gunmetal launch sleeve sunk into the ship's sponson/belly,
 * glowing clamp ring, armored capsule body, and ablative reentry nose aimed along local `-Y`.
 */
export function angledDropPodCradle(b: KitbashBuilder, opts: AngledDropPodCradleOpts): void {
  const {
    position,
    rotation = [0, 0, 0],
    scale: s = 1,
    podZone = 'hullPrimary',
    glowZone = 'energyCyan',
    name = 'orbital',
  } = opts;
  const { place } = makePlacer(position, rotation);
  b.addPart(cyl(1.04 * s, 1.14 * s, 0.88 * s, 5), 'frameGunmetal', {
    name: `${name} pod launch sleeve`,
    position: place([0, 0, 0]),
    rotation,
  });
  b.addPart(cyl(1.2 * s, 1.2 * s, 0.16 * s, 5), glowZone, {
    name: `${name} pod clamp ring light`,
    position: place([0, -0.35 * s, 0]),
    rotation,
    emissiveIntensity: 3.9,
  });
  b.addPart(cyl(0.94 * s, 0.72 * s, 1.28 * s, 5), podZone, {
    name: 'racked drop pod',
    position: place([0, -0.88 * s, 0]),
    rotation,
  });
  b.addPart(cyl(0.98 * s, 0.34 * s, 0.5 * s, 5), 'frameGunmetal', {
    name: `${name} pod heat shield`,
    position: place([0, -1.66 * s, 0]),
    rotation,
  });
}

KitbashRegistry.registerGreeble('orbitalSolarWing', (params: OrbitalSolarWingOpts, b) => orbitalSolarWing(b, params));
KitbashRegistry.registerGreeble('angledDropPodCradle', (params: AngledDropPodCradleOpts, b) =>
  angledDropPodCradle(b, params),
);
KitbashRegistry.registerGreeble('radiatorLouvres', (params: RadiatorLouvreOpts, b) => radiatorLouvreBank(b, params));
