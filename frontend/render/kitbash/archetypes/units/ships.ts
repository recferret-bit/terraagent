import * as THREE from 'three';
import { KitbashBuilder, type MaterialZoneSpec } from '../../KitbashRegistry';
import {
  angledDropPodCradle,
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
import { cyl, lathe, mirror, rbox, sag, sph, strut, type V3 } from '../../greebles/unitParts';
import { register } from './common';

const CARRIER_QUARTZ_GLASS: MaterialZoneSpec = { color: 0x38bdf8, roughness: 0.08, metalness: 0.35, emissiveIntensity: 0 };
/** Exact longitudinal bbox center (`(-25.58 + 24.30) * 0.5`) so `drop bay docking collar` lands at `z = 0` in `carrier.root`. */
const CARRIER_BAY_Z = -0.64;

function buildCarrierHullAndBow(b: KitbashBuilder): void {
  b.addPart(chamferBox(9.0, 6.0, 29.0, 1.05), 'hullPrimary', {
    name: 'carrier main hull',
    position: [0, 0.2, -1.5],
  });
  b.addPart(chamferBox(8.2, 1.0, 28.0, 0.2), 'frameGunmetal', {
    name: 'keel armor spine',
    position: [0, -3.05, -1.5],
  });
  for (const z of [5.2, -8.4]) {
    b.addPart(bevelSlab(9.46, 6.32, 0.95, 0.16), 'hullSecondary', {
      name: 'hull bulkhead rib',
      position: [0, 0.2, z],
    });
  }

  mirror((s) => {
    radiatorLouvreBank(b, {
      position: [4.52 * s, 0.55, -1.6],
      rotation: [0, (Math.PI / 2) * s, 0],
      width: 5.2,
      height: 2.3,
      depth: 0.28,
      slats: 4,
      slatZone: 'hullSecondary',
      name: s > 0 ? 'starboard hull' : 'port hull',
    });
  });

  b.addPart(chamferBox(4.8, 4.1, 8.2, 0.5), 'hullPrimary', {
    name: 'forward sensor spine',
    position: [0, 0.25, 16.2],
  });
  b.addPart(bevelSlab(3.4, 0.86, 0.34, 0.03, 'z', 1), 'glassVisor', {
    name: 'bow sensor visor',
    position: [0, 1.32, 20.22],
    rotation: [-0.15, 0, 0],
  });
  b.addPart(cyl(0.85, 1.45, 5.2, 6), 'hullSecondary', {
    name: 'nose dorsal crest',
    position: [0, 2.48, 17.0],
    rotation: [Math.PI / 2 + 0.22, 0, 0],
    scale: [1, 1, 0.26],
  });
  mirror((s) => {
    const mx = 3.25 * s;
    b.addPart(chamferBox(2.4, 3.3, 9.8, 0.42), 'hullPrimary', {
      name: 'bow mandible prow',
      position: [mx, -0.05, 18.6],
    });
    b.addPart(bevelSlab(0.28, 1.85, 3.8, 0.06, 'x', s), 'frameGunmetal', {
      name: 'bow aesa radar mount',
      position: [mx + 1.18 * s, 0.15, 19.2],
    });
    b.addPart(bevelSlab(0.18, 1.45, 3.2, 0.04, 'x', s), 'hullSecondary', {
      name: 'bow aesa radar array',
      position: [mx + 1.32 * s, 0.15, 19.2],
    });
    b.addPart(chamferBox(1.85, 2.1, 0.85, 0.14), 'frameGunmetal', {
      name: 'mandible bumper cap',
      position: [mx, -0.05, 23.6],
    });
    b.addPart(new THREE.OctahedronGeometry(0.26, 0), 'warningAmber', {
      name: 'bow clearance beacon light',
      position: [mx, 0.55, 24.04],
      emissiveIntensity: 3.9,
    });
  });

  const bowPivot: V3 = [0, 0.15, 21.1];
  b.addPart(cyl(0.62, 0.72, 1.1, 6), 'frameGunmetal', {
    name: 'bow scanner mantlet',
    position: [0, 0.15, 20.45],
    rotation: [Math.PI / 2, 0, 0],
  });
  b.addPart(cyl(0.32, 0.38, 1.65, 6), 'hullSecondary', {
    name: 'bow lidar barrel',
    position: [0, 0.15, 21.65],
    rotation: [Math.PI / 2, 0, 0],
    animType: 3,
    animPivot: bowPivot,
  });
  b.addPart(cyl(0.26, 0.26, 0.18, 6), 'energyCyan', {
    name: 'bow lidar emitter light',
    position: [0, 0.15, 22.52],
    rotation: [Math.PI / 2, 0, 0],
    emissiveIntensity: 4.3,
    animType: 3,
    animPivot: bowPivot,
  });
}

function buildCarrierTowerAndSolar(b: KitbashBuilder): void {
  b.addPart(chamferBox(5.6, 2.35, 8.4, 0.38), 'hullPrimary', {
    name: 'ops deck superstructure',
    position: [0, 4.15, 6.8],
  });
  b.addPart(bevelSlab(4.4, 0.92, 0.36, 0.03, 'z', 1), 'glassVisor', {
    name: 'ops deck front glass',
    position: [0, 4.35, 10.92],
    rotation: [-0.15, 0, 0],
  });
  mirror((s) => {
    b.addPart(bevelSlab(0.28, 0.85, 5.4, 0.03, 'x', s), 'glassVisor', {
      name: 'ops deck gallery window',
      position: [2.74 * s, 4.35, 6.9],
    });
  });
  b.addPart(chamferBox(3.9, 1.85, 5.2, 0.3), 'hullSecondary', {
    name: 'command bridge citadel',
    position: [0, 6.05, 5.6],
  });
  b.addPart(bevelSlab(3.1, 0.78, 0.34, 0.03, 'z', 1), 'glassVisor', {
    name: 'bridge cockpit visor',
    position: [0, 6.18, 8.12],
    rotation: [-0.18, 0, 0],
  });
  b.addPart(bevelSlab(2.7, 0.16, 0.2, 0.02, 'z', 1), 'energyCyan', {
    name: 'bridge brow light',
    position: [0, 6.72, 8.16],
    emissiveIntensity: 4.1,
  });
  mirror((s) => {
    b.addPart(bevelSlab(0.26, 0.68, 2.8, 0.03, 'x', s), 'glassVisor', {
      name: 'bridge side window',
      position: [1.88 * s, 6.15, 5.8],
    });
  });

  b.addPart(chamferBox(2.8, 0.75, 3.0, 0.14), 'frameGunmetal', {
    name: 'belly spotter housing',
    position: [0, -3.72, 8.2],
  });
  b.addPart(bevelSlab(2.1, 0.36, 2.2, 0.04, 'y', -1), 'glassVisor', {
    name: 'belly spotter glass',
    position: [0, -4.02, 8.2],
  });

  mirror((s) => {
    b.addPart(chamferBox(1.6, 1.5, 2.8, 0.18), 'frameGunmetal', {
      name: 'solar wing shoulder mount',
      position: [4.95 * s, 0.75, -5.8],
    });
    strut(b, [5.4 * s, 0.75, -5.8], [8.35 * s, 0.95, -5.8], 0.36, 'frameGunmetal', {
      name: 'solar wing root boom',
    });
    b.addPart(sph(0.56, 6, 4), 'hullSecondary', {
      name: 'solar wing gimbal joint',
      position: [8.35 * s, 0.95, -5.8],
    });
    orbitalSolarWing(b, {
      position: [14.15 * s, 0.95, -5.8],
      rotation: [0.14, 0, 0.05 * s],
      span: 11.2,
      chord: 5.8,
      thickness: 0.32,
      cols: 4,
      rows: 2,
      busZone: 'hullPrimary',
      ribZone: 'hullSecondary',
      tipSide: s,
      tipGlowZone: s > 0 ? 'terraformEmerald' : 'dangerCrimson',
      name: s > 0 ? 'starboard carrier' : 'port carrier',
    });
  });
}

function buildCarrierReactorAndBay(b: KitbashBuilder): void {
  b.addPart(cyl(2.15, 2.35, 0.72, 6), 'frameGunmetal', {
    name: 'reactor well housing',
    position: [0, 3.42, -4.6],
  });
  const gyroPiv: V3 = [0, 3.78, -4.6];
  const gyroSpin = { animType: 1 as const, animPivot: gyroPiv };
  b.addPart(cyl(0.76, 0.76, 0.56, 6), 'hullSecondary', {
    name: 'reactor turbine hub',
    position: [0, 3.94, -4.6],
    ...gyroSpin,
  });
  for (let i = 0; i < 2; i++) {
    b.addPart(bevelSlab(4.1, 0.22, 0.44, 0.03, 'y', 1), 'hullPrimary', {
      name: `reactor turbine vane ${i + 1}`,
      position: [0, 4.02 + i * 0.06, -4.6],
      rotation: [0, (i * Math.PI) / 2, 0],
      ...gyroSpin,
    });
  }
  b.addPart(cyl(0.42, 0.42, 0.16, 6), 'energyCyan', {
    name: 'reactor core ring light',
    position: [0, 4.24, -4.6],
    emissiveIntensity: 4.1,
    ...gyroSpin,
  });

  mirror((s) => {
    b.addPart(cyl(1.15, 1.15, 5.4, 6), 'hullPrimary', {
      name: 'dorsal cryo tank',
      position: [2.25 * s, 3.65, -12.2],
      rotation: [Math.PI / 2, 0, 0],
    });
    for (const dz of [-1.4, 1.4]) {
      b.addPart(cyl(1.23, 1.23, 0.32, 6), 'frameGunmetal', {
        name: 'cryo tank strap',
        position: [2.25 * s, 3.65, -12.2 + dz],
        rotation: [Math.PI / 2, 0, 0],
      });
    }
  });

  b.addPart(chamferBox(5.6, 0.82, 12.8, 0.16), 'hullSecondary', {
    name: 'drop bay coaming',
    position: [0, -3.72, CARRIER_BAY_Z],
  });
  b.addPart(bevelSlab(4.1, 0.45, 11.4, 0.08), 'frameGunmetal', {
    name: 'drop bay well',
    position: [0, -4.08, CARRIER_BAY_Z],
  });
  b.addPart(cyl(1.68, 1.78, 0.66, 6), 'frameGunmetal', {
    name: 'drop bay docking collar',
    position: [0, -4.5, CARRIER_BAY_Z],
  });
  mirror((s) => {
    b.addPart(bevelSlab(0.24, 0.24, 11.6, 0.03, 'y', -1), 'warningAmber', {
      name: 'bay guide strip light',
      position: [2.35 * s, -4.18, CARRIER_BAY_Z],
      emissiveIntensity: 3.7,
    });
    for (const z of [CARRIER_BAY_Z - 2.7, CARRIER_BAY_Z + 2.7]) {
      angledDropPodCradle(b, {
        position: [3.45 * s, -2.55, z],
        rotation: [0, 0, 0.22 * s],
        scale: 0.92,
        podZone: z > CARRIER_BAY_Z ? 'hullPrimary' : 'hullSecondary',
        glowZone: 'energyCyan',
        name: s > 0 ? 'starboard bay' : 'port bay',
      });
    }
    for (const z of [7.8, -10.8]) {
      strut(b, [3.4 * s, -2.6, z], [4.65 * s, -4.55, z], 0.24, 'frameGunmetal', { name: 'landing skid strut' });
      b.addPart(cyl(0.32, 0.32, 4.2, 6), 'frameGunmetal', {
        name: 'landing skid runner',
        position: [4.65 * s, -4.53, z],
        rotation: [Math.PI / 2, 0, 0],
      });
    }
  });
}

function buildCarrierEnginesAndSensors(b: KitbashBuilder): void {
  b.addPart(chamferBox(10.2, 6.6, 6.8, 0.8), 'frameGunmetal', {
    name: 'aft engine block',
    position: [0, 0.2, -19.0],
  });
  b.addPart(bevelSlab(10.5, 0.75, 1.4, 0.14), 'hullSecondary', {
    name: 'aft engine trim collar',
    position: [0, 3.38, -16.8],
  });
  for (const [x, y] of [[-2.65, 1.65], [2.65, 1.65], [-2.65, -1.35], [2.65, -1.35]] as const) {
    b.addPart(cyl(1.65, 1.65, 0.58, 6), 'hullSecondary', {
      name: 'thruster mount collar',
      position: [x, y, -22.5],
      rotation: [Math.PI / 2, 0, 0],
    });
    b.addPart(cyl(1.42, 1.05, 2.8, 6), 'frameGunmetal', {
      name: 'main thruster bell',
      position: [x, y, -24.0],
      rotation: [Math.PI / 2, 0, 0],
    });
    b.addPart(cyl(1.08, 1.08, 0.36, 6), 'energyCyan', {
      name: 'thruster plasma core light',
      position: [x, y, -25.4],
      rotation: [Math.PI / 2, 0, 0],
      emissiveIntensity: 4.5,
    });
  }

  slottedRadarScanner(b, {
    base: [0, 6.95, 6.2],
    mastHeight: 1.05,
    mastRadius: 0.18,
    barSpan: 3.4,
    barHeight: 0.36,
    barDepth: 0.38,
    glowZone: 'energyCyan',
    name: 'carrier dorsal',
  });
  parabolicDishRig(b, {
    base: [-2.1, 3.2, -7.8],
    mastHeight: 2.35,
    radius: 1.08,
    tilt: -0.58,
    seg: 7,
    glowZone: 'energyCyan',
    name: 'aft relay',
  });
  opticalSensorTurret(b, {
    base: [2.05, 5.3, 9.6],
    radius: 0.52,
    glowZone: 'energyCyan',
    name: 'bow lidar',
  });
  dipoleCommsMast(b, {
    base: [-1.45, 6.95, 3.9],
    height: 3.4,
    radius: 0.11,
    crossSpan: 1.65,
    glowZone: 'warningAmber',
    name: 'carrier comms',
  });
  b.addPart(cyl(0.18, 0.22, 1.15, 6), 'frameGunmetal', {
    name: 'dorsal conduit stanchion',
    position: [1.35, 3.65, -1.2],
  });
  tubeThrough(
    b,
    [
      new THREE.Vector3(1.35, 5.85, 3.06),
      new THREE.Vector3(1.35, 4.7, 0.96),
      new THREE.Vector3(1.35, 4.12, -1.14),
    ],
    0.065,
    'frameGunmetal',
    { along: 5, radial: 4 },
    { name: 'bridge telemetry cable' },
  );
}

register({
  id: 'ship.carrier',
  label: 'Orbital Carrier',
  category: 'ship',
  footprint: [12, 22],
  snap: true,
  zones: { glassVisor: CARRIER_QUARTZ_GLASS },
  notes: '50m expeditionary drop carrier: twin-mandible AESA prow, multi-deck quartz-glass bridge, swept orbital solar wings (16 cells), ventral docking collar + 4 planet-canted drop-pod cradles, spinning bar radar + parabolic dish + reactor turbine + optical turret, pulsing bow lidar, 4 plasma engines.',
  build: (b) => {
    buildCarrierHullAndBow(b);
    buildCarrierTowerAndSolar(b);
    buildCarrierReactorAndBay(b);
    buildCarrierEnginesAndSensors(b);
  },
});

// ---------------------------------------------------------------------------
// Drop pod — base at y=0 (centre of heat shield), ~3 m tall.
// ---------------------------------------------------------------------------
function podShell(b: KitbashBuilder) {
  b.addPart(
    lathe([[0.02, 0], [0.7, 0.02], [1.15, 0.14], [1.32, 0.34], [1.3, 0.5], [0.02, 0.5]], 16),
    'frameGunmetal',
    { name: 'ablative heat shield' },
  );
  b.addPart(cyl(1.34, 1.34, 0.08, 16), 'hullSecondary', { name: 'heat shield rim band', position: [0, 0.48, 0] });
  const outer: [number, number][] = [[1.25, 0.48], [1.0, 1.3], [0.68, 2.3], [0.4, 2.95]];
  const inner = outer.map(([r, y]) => [r - 0.12, y - (y > 2.9 ? 0.02 : 0)] as [number, number]).reverse();
  const prof = [...outer, ...inner];
  for (let i = 0; i < 4; i++) {
    const start = (i * Math.PI) / 2 + 0.018;
    b.addPart(lathe(prof, 8, start, Math.PI / 2 - 0.036), i % 2 ? 'hullSecondary' : 'hullPrimary', { name: `pod petal ${i + 1}` });
  }
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    strut(b, [Math.cos(a) * 1.18, 0.5, Math.sin(a) * 1.18], [Math.cos(a) * 0.38, 2.88, Math.sin(a) * 0.38], 0.042, 'frameGunmetal', { name: 'petal seam rib' });
  }
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    const x = Math.cos(a) * 1.2, z = Math.sin(a) * 1.2;
    b.addPart(cyl(0.12, 0.2, 0.34, 8), 'frameGunmetal', { name: 'retro thruster bell', position: [x, 0.66, z], rotation: [-Math.sin(a) * 0.45, 0, Math.cos(a) * 0.45] });
    b.addPart(cyl(0.15, 0.15, 0.06, 8), 'energyCyan', {
      name: 'retro thruster glow light',
      position: [x + Math.cos(a) * 0.08, 0.5, z + Math.sin(a) * 0.08], rotation: [-Math.sin(a) * 0.45, 0, Math.cos(a) * 0.45],
      emissiveIntensity: 4,
    });
  }
}

register({
  id: 'ship.dropPodShell',
  label: 'Drop Pod Shell',
  category: 'ship',
  footprint: [3, 3],
  notes: 'Detachable outer shell: ablative heat shield, 4 petal panels, retro nozzles. Hero fits inside (r~0.8).',
  build: (b) => podShell(b),
});

register({
  id: 'ship.dropPod',
  label: 'Drop Pod',
  category: 'ship',
  footprint: [3, 3],
  zones: { glassVisor: CARRIER_QUARTZ_GLASS },
  notes: 'Reentry capsule ~3.1m: shell + chute housing, hatch, folding legs, seat, beacon, antenna.',
  build: (b) => {
    podShell(b);
    b.addPart(cyl(0.9, 0.9, 0.1, 12), 'frameGunmetal', { name: 'capsule deck floor', position: [0, 0.52, 0] });
    b.addPart(rbox(0.55, 0.16, 0.45, 0.04), 'hullSecondary', { name: 'crash seat base', position: [0, 0.62, -0.2] });
    b.addPart(rbox(0.7, 1.2, 0.22, 0.08), 'frameGunmetal', { name: 'crash seat backrest', position: [0, 1.12, -0.52] });
    b.addPart(rbox(0.5, 0.1, 0.06, 0.02), 'energyCyan', { name: 'harness status light', position: [0, 1.62, -0.4], emissiveIntensity: 3.6 });
    b.addPart(cyl(0.42, 0.5, 0.38, 12), 'frameGunmetal', { name: 'drogue chute canister', position: [0, 3.02, 0] });
    b.addPart(lathe([[0.02, 0], [0.38, 0], [0.34, 0.12], [0.2, 0.22], [0.02, 0.26]], 12), 'hullSecondary', { name: 'chute cap dome', position: [0, 3.18, 0] });
    b.addPart(cyl(0.52, 0.52, 0.06, 12), 'warningAmber', { name: 'chute separation ring light', position: [0, 2.94, 0], emissiveIntensity: 3.4 });
    b.addPart(rbox(0.72, 0.9, 0.14, 0.05), 'frameGunmetal', { name: 'egress hatch frame', position: [0, 1.55, 0.88], rotation: [-0.3, 0, 0] });
    b.addPart(rbox(0.5, 0.65, 0.1, 0.04), 'glassVisor', { name: 'hatch viewport visor', position: [0, 1.56, 0.94], rotation: [-0.3, 0, 0] });
    b.addPart(rbox(0.56, 0.06, 0.08, 0.02), 'warningAmber', { name: 'hatch release strip light', position: [0, 1.16, 1.04], rotation: [-0.3, 0, 0], emissiveIntensity: 3.4 });
    for (let i = 0; i < 3; i++) {
      const a = (i * Math.PI * 2) / 3 + Math.PI / 6;
      const c = Math.cos(a), s = Math.sin(a);
      strut(b, [c * 1.05, 0.9, s * 1.05], [c * 1.62, 0.04, s * 1.62], 0.055, 'frameGunmetal', { name: 'landing leg strut' });
      b.addPart(cyl(0.2, 0.22, 0.08, 8), 'hullSecondary', { name: 'landing foot pad', position: [c * 1.62, 0.04, s * 1.62] });
    }
    strut(b, [-0.28, 2.95, -0.1], [-0.58, 3.68, -0.28], 0.025, 'frameGunmetal', { name: 'recovery aerial mast' });
    b.addPart(sph(0.07, 8, 6), 'warningAmber', { name: 'recovery beacon light', position: [-0.58, 3.7, -0.28], emissiveIntensity: 4 });
    sag(b, [0.33, 2.95, 0.33], [0.54, 1.96, 0.54], 0.07, 0.028, 'frameGunmetal', { name: 'umbilical release cable' });
  },
});
