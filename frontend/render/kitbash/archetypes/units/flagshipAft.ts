import * as THREE from 'three';
import type { KitbashBuilder, VertexColorFn } from '../../KitbashRegistry';
import {
  bevelSlab,
  chamferBox,
  dipoleCommsMast,
  opticalSensorTurret,
  orbitalSolarWing,
  parabolicDishRig,
  radiatorLouvreBank,
  slottedRadarScanner,
} from '../../greebles/shipParts';
import { tubeThrough } from '../../greebles/tube';
import { cyl, mirror, sph } from '../../greebles/unitParts';

/** Subtle longitudinal capital-hull armor strake modulation stamped into sovereign hull vertices. */
export const sovereignStrakeTint: VertexColorFn = (pos, norm, _u, _v, _zones, out) => {
  const strake = Math.sin(pos.z * 0.45) * 0.5 + 0.5;
  const band = Math.abs(norm.x) > 0.55 && Math.abs(pos.y) < 1.3 ? 0.93 : 0.97 + 0.05 * strake;
  out.multiplyScalar(band);
};

export function buildFlagshipAftAndSolarWings(b: KitbashBuilder): void {
  b.addPart(chamferBox(13.4, 7.4, 18.4, 1.1), 'hullPrimary', {
    name: 'aft dreadnought hull',
    position: [0, 0.65, -21.4],
    vertexColor: sovereignStrakeTint,
  });
  for (const z of [-14.8, -27.2]) {
    b.addPart(bevelSlab(13.86, 7.78, 1.15, 0.18), 'hullSecondary', {
      name: 'aft gold hull rib',
      position: [0, 0.65, z],
    });
  }
  mirror((s) => {
    radiatorLouvreBank(b, {
      position: [6.68 * s, 0.8, -21.0],
      rotation: [0, (Math.PI / 2) * s, 0],
      width: 5.6,
      height: 2.6,
      depth: 0.3,
      slats: 3,
      slatZone: 'hullSecondary',
      name: s > 0 ? 'starboard dreadnought' : 'port dreadnought',
    });

    b.addPart(bevelSlab(4.3, 0.85, 1.2, 0.1), 'frameGunmetal', {
      name: 'upper solar wing boom',
      position: [8.3 * s, 3.05, -17.8],
      rotation: [0, 0, 0.24 * s],
    });
    b.addPart(sph(0.68, 4, 3), 'hullSecondary', {
      name: 'upper solar gimbal joint',
      position: [10.4 * s, 3.4, -17.8],
    });
    orbitalSolarWing(b, {
      position: [18.1 * s, 5.5, -17.8],
      rotation: [0.18, 0, 0.26 * s],
      span: 15.2,
      chord: 5.8,
      thickness: 0.36,
      cols: 3,
      rows: 2,
      busZone: 'hullSecondary',
      ribZone: 'hullPrimary',
      tipSide: s,
      tipGlowZone: 'energyCyan',
      name: s > 0 ? 'upper starboard' : 'upper port',
    });

    b.addPart(bevelSlab(4.1, 0.82, 1.2, 0.1), 'frameGunmetal', {
      name: 'lower solar wing boom',
      position: [8.2 * s, -1.5, -24.8],
      rotation: [0, 0, -0.2 * s],
    });
    b.addPart(sph(0.64, 4, 3), 'hullSecondary', {
      name: 'lower solar gimbal joint',
      position: [10.2 * s, -1.85, -24.8],
    });
    orbitalSolarWing(b, {
      position: [17.3 * s, -3.55, -24.8],
      rotation: [0.18, 0, -0.22 * s],
      span: 14.0,
      chord: 5.4,
      thickness: 0.34,
      cols: 3,
      rows: 2,
      busZone: 'hullPrimary',
      ribZone: 'hullSecondary',
      tipSide: s,
      tipGlowZone: 'warningAmber',
      name: s > 0 ? 'lower starboard' : 'lower port',
    });
  });
}

export function buildFlagshipCitadel(b: KitbashBuilder): void {
  b.addPart(chamferBox(8.4, 3.3, 10.2, 0.28), 'hullPrimary', {
    name: 'citadel fleet ops deck',
    position: [0, 5.65, -19.2],
    vertexColor: sovereignStrakeTint,
  });
  b.addPart(bevelSlab(6.9, 1.24, 0.44, 0.04, 'z', 1), 'glassVisor', {
    name: 'fleet ops front glass',
    position: [0, 5.95, -14.02],
    rotation: [-0.14, 0, 0],
  });
  mirror((s) => {
    b.addPart(bevelSlab(0.36, 1.16, 6.6, 0.04, 'x', s), 'glassVisor', {
      name: 'fleet ops side window',
      position: [4.14 * s, 5.95, -19.0],
    });
    b.addPart(bevelSlab(0.34, 1.9, 1.9, 0.06, 'x', s), 'frameGunmetal', {
      name: 'citadel aesa radar mount',
      position: [4.25 * s, 4.75, -15.8],
      rotation: [Math.PI / 4, 0, 0],
    });
    b.addPart(bevelSlab(0.24, 1.45, 1.45, 0.04, 'x', s), 'hullSecondary', {
      name: 'citadel aesa radar plate',
      position: [4.42 * s, 4.75, -15.8],
      rotation: [Math.PI / 4, 0, 0],
    });
  });

  b.addPart(chamferBox(5.8, 2.55, 7.0, 0.24), 'hullSecondary', {
    name: 'sovereign patron bridge',
    position: [0, 8.2, -19.8],
  });
  b.addPart(bevelSlab(4.6, 1.08, 0.4, 0.04, 'z', 1), 'glassVisor', {
    name: 'patron bridge canopy',
    position: [0, 8.45, -16.22],
    rotation: [-0.18, 0, 0],
  });
  b.addPart(bevelSlab(4.1, 0.22, 0.26, 0.03, 'z', 1), 'energyCyan', {
    name: 'patron bridge brow light',
    position: [0, 9.18, -16.28],
    emissiveIntensity: 4.2,
  });
  mirror((s) => {
    b.addPart(bevelSlab(0.34, 0.96, 4.2, 0.04, 'x', s), 'glassVisor', {
      name: 'patron bridge wing window',
      position: [2.84 * s, 8.45, -19.6],
    });
  });

  b.addPart(cyl(1.85, 2.15, 1.38, 5), 'glassVisor', {
    name: 'astrogation glass cupola',
    position: [0, 10.0, -20.4],
  });
  b.addPart(cyl(1.98, 1.98, 0.32, 5), 'hullSecondary', {
    name: 'astrogation crown collar',
    position: [0, 10.72, -20.4],
  });
  b.addPart(cyl(0.24, 0.82, 3.5, 4), 'hullSecondary', {
    name: 'flagship command crest',
    position: [0, 12.32, -20.4],
    rotation: [0, Math.PI / 4, 0],
    scale: [0.55, 1, 1.65],
  });
}

export function buildFlagshipEngines(b: KitbashBuilder): void {
  b.addPart(chamferBox(11.8, 6.4, 4.8, 0.36), 'frameGunmetal', {
    name: 'capital drive manifold',
    position: [0, 0.65, -32.4],
  });
  mirror((s) => {
    const ix = 2.4 * s;
    b.addPart(cyl(2.25, 2.25, 0.72, 5), 'hullSecondary', {
      name: 'capital main thruster collar',
      position: [ix, 0.75, -35.0],
      rotation: [Math.PI / 2, 0, 0],
    });
    b.addPart(cyl(2.0, 1.48, 3.6, 5), 'frameGunmetal', {
      name: 'capital main thruster bell',
      position: [ix, 0.75, -36.9],
      rotation: [Math.PI / 2, 0, 0],
    });
    b.addPart(cyl(1.54, 1.54, 0.42, 5), 'energyCyan', {
      name: 'capital main plasma light',
      position: [ix, 0.75, -38.8],
      rotation: [Math.PI / 2, 0, 0],
      emissiveIntensity: 4.6,
    });

    const ox = 5.3 * s;
    b.addPart(cyl(1.45, 1.45, 0.58, 5), 'hullSecondary', {
      name: 'auxiliary booster collar',
      position: [ox, 0.75, -34.9],
      rotation: [Math.PI / 2, 0, 0],
    });
    b.addPart(cyl(1.25, 0.95, 2.7, 5), 'frameGunmetal', {
      name: 'auxiliary booster bell',
      position: [ox, 0.75, -36.35],
      rotation: [Math.PI / 2, 0, 0],
    });
    b.addPart(cyl(0.98, 0.98, 0.36, 5), 'energyCyan', {
      name: 'auxiliary plasma core light',
      position: [ox, 0.75, -37.75],
      rotation: [Math.PI / 2, 0, 0],
      emissiveIntensity: 4.4,
    });
  });
}

export function buildFlagshipSensors(b: KitbashBuilder): void {
  slottedRadarScanner(b, {
    base: [0, 3.8, 22.0],
    mastHeight: 1.55,
    mastRadius: 0.24,
    barSpan: 5.6,
    barHeight: 0.46,
    barDepth: 0.48,
    glowZone: 'energyCyan',
    name: 'sovereign phased',
  });
  parabolicDishRig(b, {
    base: [-3.2, 3.8, 12.2],
    mastHeight: 1.55,
    radius: 1.52,
    tilt: -0.58,
    seg: 6,
    glowZone: 'energyCyan',
    name: 'quantum uplink',
  });
  opticalSensorTurret(b, {
    base: [0, 4.18, 27.6],
    radius: 0.72,
    glowZone: 'energyCyan',
    name: 'sovereign optical',
  });
  dipoleCommsMast(b, {
    base: [2.45, 9.4, -21.8],
    height: 4.5,
    radius: 0.14,
    crossSpan: 2.2,
    glowZone: 'warningAmber',
    name: 'sovereign comms',
  });
  mirror((s) => {
    tubeThrough(
      b,
      [
        new THREE.Vector3(3.05 * s, -1.1, 5.2),
        new THREE.Vector3(3.05 * s, -2.1, -3.4),
        new THREE.Vector3(3.05 * s, -1.1, -12.3),
      ],
      0.09,
      'frameGunmetal',
      { along: 4, radial: 4 },
      { name: 'reactor power cable' },
    );
  });
}
