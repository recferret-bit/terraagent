import * as THREE from 'three';
import type { KitbashBuilder, MaterialZoneSpec } from '../../KitbashRegistry';
import { bevelSlab, chamferBox, dipoleCommsMast, radiatorLouvreBank, slottedRadarScanner } from '../../greebles/shipParts';
import { cyl, mirror, sag, sph, strut, type V3 } from '../../greebles/unitParts';
import { register } from './common';

/** Faction Plate `--ta-blue-hi` Guild merchant livery + bloom-safe industrial titanium hull + luminous quartz glass. */
const GUILD_HULL: MaterialZoneSpec = { color: 0xbcc7d6, roughness: 0.44, metalness: 0.22, emissiveIntensity: 0 };
const GUILD_BLUE: MaterialZoneSpec = { color: 0x5b8cff, roughness: 0.4, metalness: 0.18, emissiveIntensity: 0 };
const GUILD_QUARTZ_GLASS: MaterialZoneSpec = { color: 0x38bdf8, roughness: 0.08, metalness: 0.35, emissiveIntensity: 0 };

function buildTraderKeelAndCab(b: KitbashBuilder): void {
  b.addPart(chamferBox(2.3, 0.76, 12.8, 0.16), 'frameGunmetal', {
    name: 'freighter keel spine',
    position: [0, 1.38, -0.2],
  });
  b.addPart(cyl(0.66, 0.76, 0.36, 6), 'frameGunmetal', {
    name: 'belly cargo collar',
    position: [0, 0.9, -0.4],
  });
  mirror((s) => {
    for (const z of [2.9, -3.4]) {
      strut(b, [1.02 * s, 1.28, z], [1.95 * s, 0.26, z], 0.11, 'frameGunmetal', { name: 'landing skid strut' });
    }
    b.addPart(chamferBox(0.44, 0.3, 7.6, 0.07), 'rubberDark', {
      name: 'landing skid runner',
      position: [1.95 * s, 0.15, -0.35],
    });
    b.addPart(bevelSlab(0.5, 0.08, 1.5, 0.02, 'y', 1), 'hullSecondary', {
      name: 'landing skid toe cap',
      position: [1.95 * s, 0.315, 2.7],
    });
  });

  b.addPart(chamferBox(3.7, 2.35, 4.3, 0.36), 'hullPrimary', {
    name: 'tug cabin hull',
    position: [0, 2.52, 5.15],
  });
  b.addPart(bevelSlab(3.86, 0.36, 3.8, 0.08, 'y', 1), 'hullSecondary', {
    name: 'cabin brow armor hood',
    position: [0, 3.74, 5.1],
  });
  b.addPart(bevelSlab(1.55, 0.16, 1.25, 0.03, 'y', 1), 'glassVisor', {
    name: 'cabin roof canopy glass',
    position: [0, 3.9, 6.05],
  });
  b.addPart(chamferBox(3.2, 0.56, 1.25, 0.13), 'frameGunmetal', {
    name: 'docking bumper frame',
    position: [0, 1.54, 6.9],
  });
  b.addPart(bevelSlab(2.85, 1.02, 0.32, 0.03, 'z', 1), 'glassVisor', {
    name: 'cockpit front windshield',
    position: [0, 2.8, 7.22],
    rotation: [-0.16, 0, 0],
  });
  b.addPart(bevelSlab(0.16, 1.08, 0.38, 0.02, 'z', 1), 'frameGunmetal', {
    name: 'cockpit windshield frame',
    position: [0, 2.8, 7.25],
    rotation: [-0.16, 0, 0],
  });
  b.addPart(bevelSlab(2.45, 0.12, 0.18, 0.02, 'z', 1), 'energyCyan', {
    name: 'cockpit telemetry brow light',
    position: [0, 3.4, 7.28],
    emissiveIntensity: 3.9,
  });
  mirror((s) => {
    b.addPart(bevelSlab(0.24, 0.9, 2.05, 0.03, 'x', s), 'glassVisor', {
      name: 'cabin side window',
      position: [1.82 * s, 2.78, 5.55],
    });
    b.addPart(bevelSlab(0.26, 0.26, 2.2, 0.04, 'x', s), 'frameGunmetal', {
      name: 'cabin cheek rub rail',
      position: [1.84 * s, 2.1, 5.4],
    });
    b.addPart(chamferBox(1.3, 0.44, 1.05, 0.08), 'hullSecondary', {
      name: 'forward vtol cheek pod',
      position: [2.38 * s, 1.72, 4.65],
    });
    b.addPart(cyl(0.28, 0.38, 0.42, 6), 'frameGunmetal', {
      name: 'vtol belly nozzle',
      position: [2.52 * s, 1.38, 4.65],
    });
  });

  const rangePivot: V3 = [0, 1.54, 7.95];
  b.addPart(cyl(0.24, 0.28, 0.46, 6), 'hullSecondary', {
    name: 'rangefinder mantlet mount',
    position: [0, 1.54, 7.68],
    rotation: [Math.PI / 2, 0, 0],
  });
  b.addPart(cyl(0.11, 0.13, 0.52, 6), 'frameGunmetal', {
    name: 'rangefinder piston',
    position: [0, 1.54, 8.06],
    rotation: [Math.PI / 2, 0, 0],
    animType: 3,
    animPivot: rangePivot,
  });
  b.addPart(sph(0.12, 5, 4), 'warningAmber', {
    name: 'rangefinder beacon light',
    position: [0, 1.54, 8.4],
    emissiveIntensity: 3.9,
    animType: 3,
    animPivot: rangePivot,
  });
}

function buildTraderCargoAndCrane(b: KitbashBuilder): void {
  b.addPart(chamferBox(1.55, 1.45, 7.8, 0.18), 'frameGunmetal', {
    name: 'cargo spine truss',
    position: [0, 2.42, -0.75],
  });
  for (const z of [1.15, -2.55]) {
    b.addPart(bevelSlab(5.5, 0.42, 0.58, 0.08), 'frameGunmetal', {
      name: 'cargo saddle beam',
      position: [0, 2.38, z],
    });
  }
  mirror((s) => {
    [1.15, -2.55].forEach((z, idx) => {
      const isBlue = (idx === 0 && s > 0) || (idx === 1 && s < 0);
      const podZone = isBlue ? 'hullSecondary' : 'hullPrimary';
      const strapZone = isBlue ? 'hullPrimary' : 'hullSecondary';
      const cx = 2.02 * s;
      b.addPart(chamferBox(1.68, 1.72, 3.15, 0.2), podZone, {
        name: 'guild cargo pod',
        position: [cx, 2.44, z],
      });
      for (const dz of [-0.82, 0.82]) {
        b.addPart(bevelSlab(1.78, 1.82, 0.22, 0.04), strapZone, {
          name: 'guild cargo strap',
          position: [cx, 2.44, z + dz],
        });
      }
      b.addPart(bevelSlab(0.14, 0.22, 0.42, 0.02, 'x', s), 'energyCyan', {
        name: 'cargo manifest seal light',
        position: [cx + 0.84 * s, 2.95, z],
        emissiveIntensity: 3.6,
      });
    });
  });

  b.addPart(cyl(0.44, 0.5, 0.36, 6), 'frameGunmetal', {
    name: 'crane turntable',
    position: [0, 3.25, 0.65],
  });
  strut(b, [0, 3.35, 0.65], [0, 4.18, -1.35], 0.12, 'hullSecondary', { name: 'cargo crane boom' });
  b.addPart(sph(0.18, 5, 4), 'frameGunmetal', { name: 'crane knuckle joint', position: [0, 4.18, -1.35] });
  strut(b, [0, 4.18, -1.35], [0, 3.56, -3.25], 0.095, 'hullPrimary', { name: 'cargo crane jib' });
  b.addPart(bevelSlab(0.32, 0.26, 0.36, 0.04), 'frameGunmetal', {
    name: 'crane grapple jaw',
    position: [0, 3.48, -3.32],
  });
}

function buildTraderDrive(b: KitbashBuilder): void {
  mirror((s) => {
    b.addPart(bevelSlab(2.2, 0.42, 0.86, 0.08), 'frameGunmetal', {
      name: 'outrigger pylon',
      position: [2.88 * s, 2.25, -5.15],
    });
    b.addPart(chamferBox(1.12, 1.04, 2.45, 0.18), 'hullPrimary', {
      name: 'vtol thruster pod',
      position: [3.95 * s, 2.22, -5.15],
    });
    b.addPart(bevelSlab(1.18, 0.22, 1.65, 0.04), 'hullSecondary', {
      name: 'vtol pod shroud',
      position: [3.95 * s, 2.78, -5.15],
    });
    b.addPart(cyl(0.34, 0.44, 0.45, 6), 'frameGunmetal', {
      name: 'vtol belly nozzle',
      position: [3.95 * s, 1.56, -5.15],
    });
    b.addPart(sph(0.14, 5, 4), s > 0 ? 'terraformEmerald' : 'dangerCrimson', {
      name: 'outrigger nav strobe light',
      position: [4.54 * s, 2.22, -5.15],
      emissiveIntensity: 3.9,
    });
  });

  b.addPart(chamferBox(3.8, 2.25, 2.9, 0.3), 'frameGunmetal', {
    name: 'aft engine housing',
    position: [0, 2.38, -5.95],
  });
  b.addPart(bevelSlab(3.92, 0.32, 1.15, 0.06), 'hullSecondary', {
    name: 'aft drive collar band',
    position: [0, 3.55, -5.2],
  });
  radiatorLouvreBank(b, {
    position: [0, 3.55, -6.45],
    rotation: [-Math.PI / 2, 0, 0],
    width: 2.5,
    height: 1.35,
    depth: 0.22,
    slats: 3,
    slatZone: 'hullPrimary',
    name: 'aft drive',
  });
  mirror((s) => {
    const ex = 1.08 * s;
    b.addPart(cyl(0.76, 0.76, 0.38, 6), 'hullSecondary', {
      name: 'main thruster collar',
      position: [ex, 2.32, -7.45],
      rotation: [Math.PI / 2, 0, 0],
    });
    b.addPart(cyl(0.68, 0.5, 1.35, 6), 'frameGunmetal', {
      name: 'main thruster bell',
      position: [ex, 2.32, -8.18],
      rotation: [Math.PI / 2, 0, 0],
    });
    b.addPart(cyl(0.52, 0.52, 0.2, 6), 'energyCyan', {
      name: 'thruster plasma core light',
      position: [ex, 2.32, -8.82],
      rotation: [Math.PI / 2, 0, 0],
      emissiveIntensity: 4.4,
    });
  });
}

function buildTraderSensors(b: KitbashBuilder): void {
  const rotorPiv: V3 = [1.22, 3.85, -5.2];
  b.addPart(cyl(0.18, 0.24, 0.38, 5), 'frameGunmetal', {
    name: 'telemetry rotor pedestal',
    position: [1.22, 3.68, -5.2],
  });
  b.addPart(bevelSlab(1.15, 0.12, 0.22, 0.02, 'y', 1), 'hullSecondary', {
    name: 'telemetry rotor bar',
    position: [1.22, 3.92, -5.2],
    animType: 1,
    animPivot: rotorPiv,
  });
  b.addPart(new THREE.OctahedronGeometry(0.13, 0), 'energyCyan', {
    name: 'telemetry rotor tip light',
    position: [1.22, 4.06, -5.2],
    emissiveIntensity: 4.0,
    animType: 1,
    animPivot: rotorPiv,
  });

  slottedRadarScanner(b, {
    base: [0, 3.9, 4.75],
    mastHeight: 0.65,
    mastRadius: 0.14,
    barSpan: 2.35,
    barHeight: 0.26,
    barDepth: 0.28,
    glowZone: 'energyCyan',
    name: 'freighter nav',
  });
  dipoleCommsMast(b, {
    base: [-1.28, 3.5, -5.85],
    height: 1.95,
    radius: 0.08,
    crossSpan: 1.05,
    glowZone: 'warningAmber',
    name: 'freighter',
  });
  sag(b, [-0.95, 3.74, 3.26], [-0.95, 3.55, -4.68], 0.34, 0.04, 'frameGunmetal', {
    name: 'cab power cable',
  });
}

register({
  id: 'ship.guildTrader',
  label: 'Guild Trader',
  category: 'ship',
  footprint: [5, 10],
  snap: true,
  zones: {
    hullPrimary: GUILD_HULL,
    hullSecondary: GUILD_BLUE,
    glassVisor: GUILD_QUARTZ_GLASS,
  },
  notes: 'Compact 18m autonomous Guild cargo freighter: panoramic quartz-glass tug cab + skylight, open spine truss with 4 intermodal cargo pods, folded loading crane, 4 VTOL belly thrusters, spinning nav radar + telemetry rotor, and pulsing rangefinder.',
  build: (b) => {
    buildTraderKeelAndCab(b);
    buildTraderCargoAndCrane(b);
    buildTraderDrive(b);
    buildTraderSensors(b);
  },
});
