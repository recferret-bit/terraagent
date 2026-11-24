import * as THREE from 'three';
import { KitbashBuilder, KitbashRegistry, type MaterialZoneId } from '../KitbashRegistry';
import { bevelSlab, makePlacer } from './shipPrimitives';
import { cyl, lathe, sph, type V3 } from './unitParts';

export * from './shipPrimitives';

export interface SlottedRadarOpts {
  base: V3;
  mastHeight?: number;
  mastRadius?: number;
  barSpan?: number;
  barHeight?: number;
  barDepth?: number;
  glowZone?: MaterialZoneId;
  name?: string;
}

/** Rotating waveguide slotted-bar phased-array radar (`animType = 1` `SpinY`). */
export function slottedRadarScanner(b: KitbashBuilder, opts: SlottedRadarOpts): void {
  const {
    base,
    mastHeight = 1.1,
    mastRadius = 0.16,
    barSpan = 2.6,
    barHeight = 0.34,
    barDepth = 0.36,
    glowZone = 'energyCyan',
    name = 'slotted',
  } = opts;
  const [x, y0, z] = base;
  const mastBottom = y0 - 0.08;
  const mastTop = y0 + mastHeight;
  b.addPart(cyl(mastRadius * 0.86, mastRadius * 1.18, mastTop - mastBottom, 5), 'frameGunmetal', {
    name: `${name} radar pedestal`,
    position: [x, (mastBottom + mastTop) / 2, z],
  });

  const piv: V3 = [x, mastTop, z];
  const spin = { animType: 1 as const, animPivot: piv };
  const hubH = Math.max(0.22, barHeight * 0.75);
  const hubY = mastTop + hubH * 0.28;
  b.addPart(cyl(mastRadius * 1.38, mastRadius * 1.38, hubH, 5), 'hullSecondary', {
    name: `${name} radar motor mount`,
    position: [x, hubY, z],
    ...spin,
  });

  const barY = hubY + hubH * 0.5 + barHeight * 0.34;
  b.addPart(bevelSlab(barSpan, barHeight, barDepth, 0.05), 'hullPrimary', {
    name: `${name} radar scanner bar`,
    position: [x, barY, z],
    ...spin,
  });
  b.addPart(bevelSlab(barSpan * 0.84, barHeight * 0.46, barDepth * 0.32, 0.02, 'z', 1), glowZone, {
    name: `${name} radar waveguide light`,
    position: [x, barY, z + barDepth * 0.44],
    emissiveIntensity: 3.9,
    ...spin,
  });
  for (const s of [-1, 1] as const) {
    b.addPart(bevelSlab(barHeight * 0.38, barHeight * 1.18, barDepth * 1.12, 0.024, 'x', s), 'frameGunmetal', {
      name: `${name} radar end fin`,
      position: [x + s * (barSpan * 0.49), barY, z],
      ...spin,
    });
  }
}

export interface ParabolicDishOpts {
  base: V3;
  mastHeight?: number;
  radius?: number;
  tilt?: number;
  seg?: number;
  glowZone?: MaterialZoneId;
  name?: string;
}

/** Rotating parabolic deep-space dish with azimuth collar and sub-reflector feed (`animType = 1` `SpinY`). */
export function parabolicDishRig(b: KitbashBuilder, opts: ParabolicDishOpts): void {
  const {
    base,
    mastHeight = 1.0,
    radius = 1.1,
    tilt = -0.58,
    seg = 7,
    glowZone = 'energyCyan',
    name = 'deep space',
  } = opts;
  const [x, y0, z] = base;
  const mastBottom = y0 - 0.08;
  const mastTop = y0 + mastHeight;
  b.addPart(cyl(radius * 0.12, radius * 0.16, mastTop - mastBottom, 5), 'frameGunmetal', {
    name: `${name} dish mast`,
    position: [x, (mastBottom + mastTop) / 2, z],
  });
  const piv: V3 = [x, mastTop + radius * 0.12, z];
  const spin = { animType: 1 as const, animPivot: piv };
  b.addPart(cyl(radius * 0.2, radius * 0.2, radius * 0.32, 5), 'hullSecondary', {
    name: `${name} dish yoke mount`,
    position: [x, mastTop + radius * 0.06, z],
    ...spin,
  });
  b.addPart(
    lathe(
      [
        [0.02, 0],
        [radius * 0.5, radius * 0.12],
        [radius, radius * 0.42],
        [0.02, radius * 0.13],
      ],
      seg,
    ),
    'hullPrimary',
    {
      name: `${name} radar dish`,
      position: piv,
      rotation: [tilt, 0, 0],
      ...spin,
    },
  );
  const { place } = makePlacer(piv, [tilt, 0, 0]);
  b.addPart(cyl(radius * 0.04, radius * 0.05, radius * 0.56, 5), 'frameGunmetal', {
    name: `${name} dish feed boom`,
    position: place([0, radius * 0.32, 0]),
    rotation: [tilt, 0, 0],
    ...spin,
  });
  b.addPart(new THREE.OctahedronGeometry(radius * 0.13, 0), glowZone, {
    name: `${name} dish feed light`,
    position: place([0, radius * 0.6, 0]),
    emissiveIntensity: 4.1,
    ...spin,
  });
}

export interface DipoleMastOpts {
  base: V3;
  height?: number;
  radius?: number;
  crossSpan?: number;
  glowZone?: MaterialZoneId;
  name?: string;
}

/** Cruciform cross-dipole spacecraft telemetry mast (replaces repetitive plain pole antennas). */
export function dipoleCommsMast(b: KitbashBuilder, opts: DipoleMastOpts): void {
  const { base, height = 3.2, radius = 0.11, crossSpan = 1.4, glowZone = 'warningAmber', name = 'orbital' } = opts;
  const [x, y0, z] = base;
  const bot = y0 - 0.1;
  const top = y0 + height;
  b.addPart(cyl(radius * 0.65, radius * 1.15, top - bot, 5), 'frameGunmetal', {
    name: `${name} dipole mast`,
    position: [x, (bot + top) / 2, z],
  });
  b.addPart(cyl(radius * 1.8, radius * 2.1, height * 0.12, 5), 'hullSecondary', {
    name: `${name} mast collar`,
    position: [x, y0 + height * 0.18, z],
  });
  const y1 = y0 + height * 0.62;
  const y2 = y0 + height * 0.82;
  b.addPart(bevelSlab(crossSpan, radius * 0.9, radius * 0.9, 0.02, 'y', 1), 'hullPrimary', {
    name: `${name} dipole crossbar X`,
    position: [x, y1, z],
  });
  b.addPart(bevelSlab(radius * 0.9, radius * 0.9, crossSpan * 0.78, 0.02, 'y', 1), 'hullPrimary', {
    name: `${name} dipole crossbar Z`,
    position: [x, y2, z],
  });
  b.addPart(new THREE.OctahedronGeometry(radius * 2.1, 0), glowZone, {
    name: `${name} mast beacon light`,
    position: [x, top + radius * 0.85, z],
    emissiveIntensity: 4.1,
  });
}

export interface OpticalSensorTurretOpts {
  base: V3;
  radius?: number;
  invert?: boolean;
  glowZone?: MaterialZoneId;
  name?: string;
}

/** Electro-optical / lidar sensor gimbal turret (`animType = 1` `SpinY`) with `glassVisor` aperture & laser eye. */
export function opticalSensorTurret(b: KitbashBuilder, opts: OpticalSensorTurretOpts): void {
  const { base, radius = 0.55, invert = false, glowZone = 'energyCyan', name = 'lidar' } = opts;
  const [x, y0, z] = base;
  const dir = invert ? -1 : 1;
  const collarH = radius * 0.55;
  const collarY = y0 + dir * collarH * 0.25;
  b.addPart(cyl(radius * 0.92, radius * 1.08, collarH, 5), 'frameGunmetal', {
    name: `${name} turret mount collar`,
    position: [x, collarY, z],
  });
  const ballY = y0 + dir * (collarH * 0.45 + radius * 0.68);
  const piv: V3 = [x, ballY, z];
  const spin = { animType: 1 as const, animPivot: piv };
  b.addPart(sph(radius * 0.82, 5, 4), 'hullPrimary', {
    name: `${name} optical sensor ball`,
    position: piv,
    ...spin,
  });
  b.addPart(cyl(radius * 0.42, radius * 0.46, radius * 0.36, 5), 'glassVisor', {
    name: `${name} optical camera window`,
    position: [x, ballY, z + radius * 0.68],
    rotation: [Math.PI / 2, 0, 0],
    ...spin,
  });
  b.addPart(new THREE.OctahedronGeometry(radius * 0.26, 0), glowZone, {
    name: `${name} rangefinder laser light`,
    position: [x + radius * 0.34, ballY + dir * radius * 0.16, z + radius * 0.62],
    emissiveIntensity: 4.2,
    ...spin,
  });
}

KitbashRegistry.registerGreeble('slottedRadar', (params: SlottedRadarOpts, b) => slottedRadarScanner(b, params));
KitbashRegistry.registerGreeble('parabolicDish', (params: ParabolicDishOpts, b) => parabolicDishRig(b, params));
KitbashRegistry.registerGreeble('dipoleCommsMast', (params: DipoleMastOpts, b) => dipoleCommsMast(b, params));
KitbashRegistry.registerGreeble('opticalSensorTurret', (params: OpticalSensorTurretOpts, b) =>
  opticalSensorTurret(b, params),
);
