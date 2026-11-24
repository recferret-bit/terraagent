import * as THREE from 'three';
import type { KitbashBuilder, MaterialZoneSpec } from '../../KitbashRegistry';
import { angledDropPodCradle, bevelSlab, chamferBox } from '../../greebles/shipParts';
import { cyl, lathe, mirror, type V3 } from '../../greebles/unitParts';
import { register } from './common';
import {
  buildFlagshipAftAndSolarWings,
  buildFlagshipCitadel,
  buildFlagshipEngines,
  buildFlagshipSensors,
  sovereignStrakeTint,
} from './flagshipAft';

/**
 * Sovereign Lead Patron Capital Livery:
 * - Cool Astral Ice-Titanium primary armor (`0xbccce2`, bloom-safe `< 214` sRGB) for crisp contrast against desert, forest, ocean & space
 * - Royal Burnished Gold-Bronze trim & crests (`0xe2a824`)
 * - Deep Obsidian-Cobalt tungsten skeleton (`0x182132`)
 * - Electric Sapphire orbital photovoltaic cells (`0x1d6feb`, paired with `solarHexGrid` in `FLAGSHIP_PLATING`)
 * - Luminous Cyan-Quartz spacecraft canopy glass (`0x38bdf8`)
 */
const FLAGSHIP_PLATINUM: MaterialZoneSpec = { color: 0xbccce2, roughness: 0.36, metalness: 0.28, emissiveIntensity: 0 };
const FLAGSHIP_GOLD: MaterialZoneSpec = { color: 0xe2a824, roughness: 0.25, metalness: 0.86, emissiveIntensity: 0 };
const FLAGSHIP_OBSIDIAN: MaterialZoneSpec = { color: 0x182132, roughness: 0.48, metalness: 0.82, emissiveIntensity: 0 };
const FLAGSHIP_SAPPHIRE_SOLAR: MaterialZoneSpec = {
  color: 0x1d6feb,
  roughness: 0.16,
  metalness: 0.55,
  emissiveIntensity: 0,
};
const FLAGSHIP_QUARTZ_GLASS: MaterialZoneSpec = {
  color: 0x38bdf8,
  roughness: 0.08,
  metalness: 0.35,
  emissiveIntensity: 0,
};

function buildFlagshipSpine(b: KitbashBuilder): void {
  b.addPart(chamferBox(5.6, 2.2, 54.0, 0.28), 'frameGunmetal', {
    name: 'sovereign lower keel spine',
    position: [0, -2.35, 0.4],
  });
  mirror((s) => {
    b.addPart(cyl(1.45, 1.45, 20.6, 5), 'hullPrimary', {
      name: 'midships bridging hull chine',
      position: [4.25 * s, -1.15, -3.2],
      rotation: [Math.PI / 2, 0, 0],
      scale: [0.78, 1, 0.96],
      vertexColor: sovereignStrakeTint,
    });
    b.addPart(bevelSlab(0.32, 0.42, 18.8, 0.06), 'hullSecondary', {
      name: 'midships chine gold trim',
      position: [5.28 * s, -1.15, -3.2],
    });
    for (const [z, runnerLen] of [
      [25.6, 5.6],
      [-22.4, 6.8],
    ] as const) {
      b.addPart(cyl(0.32, 0.38, 4.4, 5), 'frameGunmetal', {
        name: 'flagship skid strut',
        position: [3.95 * s, -4.72, z],
        rotation: [0, 0, 0.72 * s],
      });
      b.addPart(cyl(0.4, 0.4, runnerLen, 5), 'frameGunmetal', {
        name: 'flagship skid runner',
        position: [5.45 * s, -6.36, z],
        rotation: [Math.PI / 2, 0, 0],
      });
    }
  });

  b.addPart(chamferBox(11.8, 6.6, 19.6, 1.05), 'hullPrimary', {
    name: 'forward sovereign hull',
    position: [0, 0.55, 14.8],
    vertexColor: sovereignStrakeTint,
  });
  for (const z of [9.0, 20.2]) {
    b.addPart(bevelSlab(12.26, 6.96, 1.05, 0.18), 'hullSecondary', {
      name: 'forward gold hull rib',
      position: [0, 0.55, z],
    });
  }
  mirror((s) => {
    b.addPart(bevelSlab(0.32, 0.38, 16.8, 0.04, 'x', s), 'energyCyan', {
      name: 'flagship flank stripe light',
      position: [5.95 * s, 1.2, 14.8],
      emissiveIntensity: 4.1,
    });
  });
}

function buildFlagshipBow(b: KitbashBuilder): void {
  b.addPart(chamferBox(15.2, 5.2, 10.4, 0.92), 'hullPrimary', {
    name: 'hammerhead atrium prow',
    position: [0, 0.72, 28.8],
    vertexColor: sovereignStrakeTint,
  });
  b.addPart(cyl(4.4, 5.2, 6.8, 5), 'hullSecondary', {
    name: 'hammerhead gold crown trim',
    position: [0, 3.35, 28.6],
    rotation: [Math.PI / 2, 0, 0],
    scale: [1.08, 1, 0.22],
  });
  b.addPart(
    lathe(
      [
        [0.05, 0],
        [4.4, 0],
        [3.3, 3.8],
        [1.5, 7.1],
        [0.05, 8.2],
      ],
      5,
    ),
    'hullPrimary',
    {
      name: 'sovereign nose cone',
      position: [0, 0.68, 33.4],
      rotation: [Math.PI / 2, 0, 0],
      scale: [1.34, 1, 0.68],
      vertexColor: sovereignStrakeTint,
    },
  );
  b.addPart(cyl(0.92, 1.62, 6.2, 5), 'hullSecondary', {
    name: 'nose dorsal crest',
    position: [0, 4.18, 33.2],
    rotation: [Math.PI / 2 + 0.18, 0, 0],
    scale: [1, 1, 0.28],
  });
  b.addPart(bevelSlab(10.8, 1.65, 0.48, 0.04, 'z', 1), 'glassVisor', {
    name: 'bow atrium front glass',
    position: [0, 1.32, 33.9],
    rotation: [-0.14, 0, 0],
  });
  for (const mx of [-2.6, 2.6]) {
    b.addPart(bevelSlab(0.22, 1.72, 0.56, 0.03, 'z', 1), 'frameGunmetal', {
      name: 'atrium canopy frame bar',
      position: [mx, 1.32, 33.94],
      rotation: [-0.14, 0, 0],
    });
  }
  b.addPart(bevelSlab(9.8, 0.24, 0.34, 0.03, 'z', 1), 'energyCyan', {
    name: 'atrium header brow light',
    position: [0, 2.32, 33.98],
    emissiveIntensity: 4.1,
  });
  mirror((s) => {
    b.addPart(bevelSlab(0.38, 1.52, 6.8, 0.04, 'x', s), 'glassVisor', {
      name: 'hammerhead gallery window',
      position: [7.52 * s, 1.05, 28.8],
    });
    const lancePivot: V3 = [5.45 * s, -1.05, 35.6];
    b.addPart(cyl(0.55, 0.65, 1.3, 5), 'hullSecondary', {
      name: 'scan lance mantlet',
      position: [5.45 * s, -1.05, 34.4],
      rotation: [Math.PI / 2, 0, 0],
    });
    b.addPart(cyl(0.28, 0.34, 2.5, 5), 'frameGunmetal', {
      name: 'orbital scan lance barrel',
      position: [5.45 * s, -1.05, 36.1],
      rotation: [Math.PI / 2, 0, 0],
      animType: 3,
      animPivot: lancePivot,
    });
    b.addPart(new THREE.OctahedronGeometry(0.34, 0), 'energyCyan', {
      name: 'scan lance tip light',
      position: [5.45 * s, -1.05, 37.45],
      emissiveIntensity: 4.3,
      animType: 3,
      animPivot: lancePivot,
    });
  });
}

function buildFlagshipCentrifugeAndSponsons(b: KitbashBuilder): void {
  const centZ = -3.2;
  b.addPart(cyl(2.4, 2.75, 3.1, 5), 'frameGunmetal', {
    name: 'central reactor pedestal',
    position: [0, 0.1, centZ],
  });
  b.addPart(cyl(2.92, 2.92, 0.42, 5), 'hullSecondary', {
    name: 'reactor base collar',
    position: [0, -1.15, centZ],
  });

  const ringPiv: V3 = [0, 2.05, centZ];
  const ringSpin = { animType: 1 as const, animPivot: ringPiv };
  b.addPart(cyl(2.25, 2.25, 1.32, 5), 'hullSecondary', {
    name: 'centrifuge rotor collar',
    position: ringPiv,
    ...ringSpin,
  });
  b.addPart(cyl(1.38, 1.68, 2.1, 5), 'frameGunmetal', {
    name: 'centrifuge upper core housing',
    position: [0, 3.65, centZ],
    ...ringSpin,
  });
  b.addPart(new THREE.OctahedronGeometry(1.36, 0), 'energyCyan', {
    name: 'reactor crown orb light',
    position: [0, 4.92, centZ],
    emissiveIntensity: 4.6,
    ...ringSpin,
  });
  b.addPart(bevelSlab(13.2, 0.44, 0.48, 0.06, 'y', 1), 'frameGunmetal', {
    name: 'centrifuge spoke X',
    position: ringPiv,
    ...ringSpin,
  });
  b.addPart(bevelSlab(0.48, 0.44, 13.2, 0.06, 'y', 1), 'frameGunmetal', {
    name: 'centrifuge spoke Z',
    position: ringPiv,
    ...ringSpin,
  });
  b.addPart(new THREE.TorusGeometry(6.6, 0.58, 4, 6), 'hullPrimary', {
    name: 'gravimetric centrifuge ring',
    position: ringPiv,
    rotation: [Math.PI / 2, 0, 0],
    ...ringSpin,
  });
  b.addPart(new THREE.TorusGeometry(6.6, 0.18, 4, 6), 'energyCyan', {
    name: 'centrifuge flux ring light',
    position: [0, 2.65, centZ],
    rotation: [Math.PI / 2, 0, 0],
    emissiveIntensity: 4.0,
    ...ringSpin,
  });
  for (const [gx, gz] of [
    [6.6, 0],
    [-6.6, 0],
    [0, 6.6],
    [0, -6.6],
  ] as const) {
    b.addPart(bevelSlab(1.55, 1.38, 1.55, 0.16), 'hullSecondary', {
      name: 'centrifuge gravity pod',
      position: [gx, 2.05, centZ + gz],
      ...ringSpin,
    });
  }

  mirror((s) => {
    b.addPart(chamferBox(2.9, 2.0, 18.4, 0.22), 'frameGunmetal', {
      name: 'lower launch sponson',
      position: [3.35 * s, -3.15, 14.6],
    });
    b.addPart(bevelSlab(0.38, 0.88, 17.2, 0.08), 'hullSecondary', {
      name: 'sponson armor coaming',
      position: [4.86 * s, -3.22, 14.6],
    });
    [8.6, 14.6, 20.6].forEach((z, idx) => {
      angledDropPodCradle(b, {
        position: [3.35 * s, -3.95, z],
        rotation: [0.06, 0, 0.08 * s],
        scale: 1.32,
        podZone: idx === 1 ? 'hullSecondary' : 'hullPrimary',
        glowZone: idx === 1 ? 'warningAmber' : 'energyCyan',
        name: s > 0 ? 'starboard flagship' : 'port flagship',
      });
    });
  });
}

register({
  id: 'ship.flagshipCarrier',
  label: 'Flagship Orbital Carrier',
  category: 'ship',
  footprint: [26, 42],
  snap: true,
  zones: {
    hullPrimary: FLAGSHIP_PLATINUM,
    hullSecondary: FLAGSHIP_GOLD,
    frameGunmetal: FLAGSHIP_OBSIDIAN,
    solarCell: FLAGSHIP_SAPPHIRE_SOLAR,
    glassVisor: FLAGSHIP_QUARTZ_GLASS,
  },
  notes:
    '81m Sovereign Lead Patron capital dreadnought (ISS <pilot>.near): sculpted Atrium hammerhead prow, bridged midships reactor bay with spinning gravimetric centrifuge ring, 4 X-cruciform sapphire solar wings (24 cells), 6 planet-canted drop-pod launch tubes, cathedral quartz-glass citadel, varied radars, and 4-bell capital ion drive.',
  build: (b) => {
    buildFlagshipSpine(b);
    buildFlagshipBow(b);
    buildFlagshipCentrifugeAndSponsons(b);
    buildFlagshipAftAndSolarWings(b);
    buildFlagshipCitadel(b);
    buildFlagshipEngines(b);
    buildFlagshipSensors(b);
  },
});
