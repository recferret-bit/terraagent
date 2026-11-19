import type { KitbashBuilder, MaterialZoneId, MaterialZoneSpec, PartOptions } from '../../KitbashRegistry';
import { organ, tendril } from '../../greebles/organic/shapes';
import '../../greebles/organic/vertebrates';
import type { V3 } from '../../greebles/unitParts';
import { register } from './common';

const surface = (color: number, roughness: number): MaterialZoneSpec => ({
  color,
  roughness,
  metalness: 0,
  emissiveIntensity: 0,
});

function birdPalette(
  plumage: number,
  secondary: number,
  beakAndFeet: number,
  roughness = 0.56,
): Partial<Record<MaterialZoneId, MaterialZoneSpec>> {
  return {
    hullPrimary: surface(plumage, roughness),
    hullSecondary: surface(secondary, Math.min(0.80, roughness + 0.04)),
    frameGunmetal: surface(beakAndFeet, 0.42),
    rubberDark: surface(0x3a322d, 0.68),
    glassVisor: surface(0x16181c, 0.14),
  };
}

interface BirdAnatomySpec {
  flyY?: number;
  torsoR: V3;
  wingSpan: number;
  wingChord: number;
  wingSweep?: number;
  neckOffset: V3;
  headR: V3;
  beakPts: V3[];
  beakRadii: number[];
  tailSpread?: number;
  tailLen?: number;
  forkedTail?: boolean;
  crestHeight?: number;
  trailingLegs?: number;
}

function addAvianHeadAndBeak(b: KitbashBuilder, s: BirdAnatomySpec, flyY: number, bob: PartOptions): void {
  const neckStart: V3 = [0, flyY + s.torsoR[1] * 0.20, s.torsoR[2] * 0.78];
  const headPos: V3 = [
    neckStart[0] + s.neckOffset[0],
    neckStart[1] + s.neckOffset[1],
    neckStart[2] + s.neckOffset[2],
  ];
  const neckEnd: V3 = [
    headPos[0],
    headPos[1] - s.headR[1] * 0.28,
    headPos[2] - s.headR[2] * 0.45,
  ];
  const neckR = Math.max(0.025, s.headR[0] * 0.70);
  b.addPart(
    tendril(
      [
        neckStart,
        [0, (neckStart[1] + neckEnd[1]) * 0.5, (neckStart[2] + neckEnd[2]) * 0.5],
        neckEnd,
      ],
      [neckR * 1.08, neckR * 0.92, neckR * 0.82],
      7,
      5,
      6,
    ),
    'hullSecondary',
    { name: 'avian neck', ...bob },
  );

  b.addPart(organ(s.headR, 7, 3.6, 0.01, 9), 'hullPrimary', {
    name: 'avian head',
    position: headPos,
    ...bob,
  });

  if (s.crestHeight && s.crestHeight > 0) {
    b.addPart(
      organ([s.headR[0] * 0.36, s.crestHeight * 0.55, s.headR[2] * 0.75], 7, 4.2, 0.02, 7),
      'hullSecondary',
      {
        name: 'crown feather crest',
        position: [0, headPos[1] + s.headR[1] * 0.75 + s.crestHeight * 0.28, headPos[2] - s.headR[2] * 0.18],
        rotation: [-0.32, 0, 0],
        ...bob,
      },
    );
  }

  for (const side of [-1, 1] as const) {
    const dir = side > 0 ? 'right' : 'left';
    b.addPart(organ([0.016, 0.016, 0.020], 5, side, 0, 6), 'glassVisor', {
      name: `${dir} avian eye`,
      position: [s.headR[0] * 0.84 * side, headPos[1] + s.headR[1] * 0.14, headPos[2] + s.headR[2] * 0.34],
      ...bob,
    });
  }

  const beakRoot: V3 = [0, headPos[1] - s.headR[1] * 0.06, headPos[2] + s.headR[2] * 0.78];
  const beakWorldPts: V3[] = [
    beakRoot,
    ...s.beakPts.map(([dx, dy, dz]): V3 => [beakRoot[0] + dx, beakRoot[1] + dy, beakRoot[2] + dz]),
  ];
  b.addPart(tendril(beakWorldPts, s.beakRadii, 4, 6, 6), 'frameGunmetal', {
    name: 'keratin beak',
    role: 'whip',
    ...bob,
  });
}

function addAvianTailAndTalons(b: KitbashBuilder, s: BirdAnatomySpec, flyY: number, bob: PartOptions): void {
  const tailLen = s.tailLen ?? 0.24;
  const tailSpread = s.tailSpread ?? 0.12;
  const tailZ = -s.torsoR[2] * 0.85 - tailLen * 0.42;
  if (s.forkedTail) {
    for (const side of [-1, 1] as const) {
      const dir = side > 0 ? 'right' : 'left';
      b.addPart(
        organ([tailSpread * 0.38, 0.016, tailLen * 0.56], 7, side + 5, 0.03, 8),
        'hullSecondary',
        {
          name: `${dir} forked rectrix feather`,
          position: [tailSpread * 0.48 * side, flyY + 0.01, tailZ],
          rotation: [0.06, -side * 0.24, 0],
          ...bob,
        },
      );
    }
  } else {
    b.addPart(
      organ([tailSpread, 0.018, tailLen * 0.54], 7, 6.1, 0.03, 8),
      'hullSecondary',
      {
        name: 'fanned tail rectrices',
        position: [0, flyY + 0.01, tailZ],
        rotation: [0.06, 0, 0],
        ...bob,
      },
    );
  }

  const legReach = s.trailingLegs ?? 0;
  for (const side of [-1, 1] as const) {
    const dir = side > 0 ? 'right' : 'left';
    const lx = s.torsoR[0] * 0.46 * side;
    const ly = flyY - s.torsoR[1] * 0.74;
    const lz = -s.torsoR[2] * 0.22;
    if (legReach > 0.05) {
      b.addPart(
        tendril([[lx, ly + 0.03, lz], [lx, ly - 0.02, lz - legReach * 0.5], [lx, ly - 0.04, lz - legReach]], [0.018, 0.013, 0.010], 4, 5, 5),
        'frameGunmetal',
        { name: `${dir} trailing wading leg`, role: 'whip', ...bob },
      );
    } else {
      b.addPart(organ([0.024, 0.024, 0.042], 4, side + 8, 0, 6), 'frameGunmetal', {
        name: `${dir} tucked talon`,
        position: [lx, ly, lz],
        ...bob,
      });
    }
  }
}

function buildAvianBody(b: KitbashBuilder, s: BirdAnatomySpec): void {
  const flyY = s.flyY ?? 0.65;
  const bob: PartOptions = { animType: 2, animPivot: [0, flyY, 0] };

  b.addPart(organ(s.torsoR, 7, 1.2, 0.018, 10), 'hullPrimary', {
    name: 'pectoral body',
    position: [0, flyY, 0],
    ...bob,
  });
  b.addPart(
    organ([s.torsoR[0] * 0.64, s.torsoR[1] * 0.70, s.torsoR[2] * 0.80], 7, 2.4, 0.01, 8),
    'hullSecondary',
    { name: 'ventral breast plumage', position: [0, flyY - s.torsoR[1] * 0.34, s.torsoR[2] * 0.08], ...bob },
  );

  b.addGreeble('featheredWings', {
    wx: Math.max(0.042, s.torsoR[0] * 0.80),
    wy: flyY + s.torsoR[1] * 0.22,
    wz: s.torsoR[2] * 0.12,
    span: s.wingSpan,
    chord: s.wingChord,
    sweep: s.wingSweep,
  });

  addAvianHeadAndBeak(b, s, flyY, bob);
  addAvianTailAndTalons(b, s, flyY, bob);
}

interface BirdSpeciesEntry {
  id: string;
  label: string;
  notes: string;
  zones: Partial<Record<MaterialZoneId, MaterialZoneSpec>>;
  spec: BirdAnatomySpec;
}

const BIRD_SPECIES: readonly BirdSpeciesEntry[] = [
  // ---- forestRock (5 endemic species) ----
  {
    id: 'fauna.bird.highlandHawk',
    label: 'Highland Red-Tail Hawk',
    notes: 'Broad-winged montane raptor soaring thermals above pine ridges; hooked raptorial beak.',
    zones: birdPalette(0x6e4a35, 0xc7774a, 0xd9a83b, 0.54),
    spec: {
      torsoR: [0.10, 0.09, 0.21], wingSpan: 0.58, wingChord: 0.20, wingSweep: 0.08,
      neckOffset: [0, 0.05, 0.08], headR: [0.068, 0.064, 0.078],
      beakPts: [[0, -0.008, 0.055], [0, -0.042, 0.085]], beakRadii: [0.028, 0.018, 0.005],
      tailSpread: 0.14, tailLen: 0.24,
    },
  },
  {
    id: 'fauna.bird.pineCrossbill',
    label: 'Boreal Pine Crossbill',
    notes: 'Compact scarlet songbird circling conifer canopies in tight seed-foraging flocks.',
    zones: birdPalette(0xb8463e, 0x5c3a36, 0x70635a, 0.60),
    spec: {
      torsoR: [0.068, 0.062, 0.13], wingSpan: 0.30, wingChord: 0.12, wingSweep: 0.05,
      neckOffset: [0, 0.035, 0.055], headR: [0.052, 0.050, 0.058],
      beakPts: [[0, -0.005, 0.045], [0.006, -0.015, 0.072]], beakRadii: [0.022, 0.014, 0.005],
      tailSpread: 0.07, tailLen: 0.14, forkedTail: true,
    },
  },
  {
    id: 'fauna.bird.alpineRaven',
    label: 'Alpine Slate Raven',
    notes: 'Intelligent highland corvid patrolling crags and forest edges in pairs and small groups.',
    zones: birdPalette(0x3f4554, 0x565f73, 0x2f333d, 0.44),
    spec: {
      torsoR: [0.09, 0.082, 0.19], wingSpan: 0.50, wingChord: 0.17, wingSweep: 0.07,
      neckOffset: [0, 0.045, 0.075], headR: [0.062, 0.058, 0.074],
      beakPts: [[0, -0.006, 0.065], [0, -0.018, 0.115]], beakRadii: [0.026, 0.018, 0.006],
      tailSpread: 0.11, tailLen: 0.22,
    },
  },
  {
    id: 'fauna.bird.mountainCrane',
    label: 'Crowned Mountain Crane',
    notes: 'Migratory wading bird flying in V-formations between highland lakes and meadows.',
    zones: birdPalette(0xcfd5de, 0x566070, 0xc95242, 0.55),
    spec: {
      torsoR: [0.10, 0.09, 0.22], wingSpan: 0.64, wingChord: 0.20, wingSweep: 0.06,
      neckOffset: [0, 0.06, 0.20], headR: [0.056, 0.054, 0.068],
      beakPts: [[0, -0.004, 0.09], [0, -0.008, 0.17]], beakRadii: [0.022, 0.014, 0.005],
      tailSpread: 0.11, tailLen: 0.16, crestHeight: 0.06, trailingLegs: 0.34,
    },
  },
  {
    id: 'fauna.bird.brookKingfisher',
    label: 'Cobalt Brook Kingfisher',
    notes: 'Iridescent azure-and-amber stream diver skimming shallow highland waters.',
    zones: birdPalette(0x2d7ab8, 0xd97f38, 0x3b3532, 0.46),
    spec: {
      torsoR: [0.068, 0.064, 0.13], wingSpan: 0.28, wingChord: 0.11, wingSweep: 0.05,
      neckOffset: [0, 0.03, 0.05], headR: [0.058, 0.055, 0.066],
      beakPts: [[0, -0.002, 0.06], [0, -0.004, 0.12]], beakRadii: [0.022, 0.014, 0.005],
      tailSpread: 0.06, tailLen: 0.11, crestHeight: 0.05,
    },
  },

  // ---- oceanForest (5 endemic species) ----
  {
    id: 'fauna.bird.seaAlbatross',
    label: 'Great Pelagic Albatross',
    notes: 'Dynamic-soaring seabird with ultra-high-aspect wings gliding effortlessly over ocean swells.',
    zones: birdPalette(0xe8ecf0, 0x475261, 0xe09d52, 0.50),
    spec: {
      torsoR: [0.11, 0.095, 0.24], wingSpan: 0.82, wingChord: 0.16, wingSweep: 0.10,
      neckOffset: [0, 0.05, 0.10], headR: [0.068, 0.064, 0.080],
      beakPts: [[0, -0.004, 0.08], [0, -0.022, 0.145]], beakRadii: [0.026, 0.019, 0.007],
      tailSpread: 0.11, tailLen: 0.18,
    },
  },
  {
    id: 'fauna.bird.canopyToucan',
    label: 'Emerald-Billed Canopy Toucan',
    notes: 'Fruit-eating rainforest bird circling coastal banyan and palm stands in lively flocks.',
    zones: birdPalette(0x3a404d, 0xf0c23e, 0xe86c2c, 0.52),
    spec: {
      torsoR: [0.085, 0.080, 0.17], wingSpan: 0.38, wingChord: 0.16, wingSweep: 0.05,
      neckOffset: [0, 0.05, 0.07], headR: [0.065, 0.062, 0.072],
      beakPts: [[0, 0.006, 0.09], [0, -0.028, 0.19]], beakRadii: [0.044, 0.036, 0.010],
      tailSpread: 0.09, tailLen: 0.20,
    },
  },
  {
    id: 'fauna.bird.coralFlamingo',
    label: 'Coral Lagoon Flamingo',
    notes: 'Pink wading flock bird flying in V-formations and skimming shallow turquoise reefs.',
    zones: birdPalette(0xe87d8f, 0xf5b3be, 0x3b3538, 0.54),
    spec: {
      torsoR: [0.095, 0.088, 0.20], wingSpan: 0.56, wingChord: 0.18, wingSweep: 0.06,
      neckOffset: [0, 0.05, 0.22], headR: [0.054, 0.052, 0.064],
      beakPts: [[0, -0.008, 0.055], [0, -0.048, 0.095]], beakRadii: [0.026, 0.022, 0.008],
      tailSpread: 0.09, tailLen: 0.13, trailingLegs: 0.38,
    },
  },
  {
    id: 'fauna.bird.reefTern',
    label: 'Silver-Capped Reef Tern',
    notes: 'Agile plunge-diving seabird with forked swallow-tail skimming fish shoals.',
    zones: birdPalette(0xdce3eb, 0x3d4654, 0xd9483b, 0.48),
    spec: {
      torsoR: [0.072, 0.065, 0.15], wingSpan: 0.46, wingChord: 0.12, wingSweep: 0.11,
      neckOffset: [0, 0.035, 0.06], headR: [0.052, 0.048, 0.060],
      beakPts: [[0, -0.003, 0.055], [0, -0.008, 0.105]], beakRadii: [0.020, 0.012, 0.004],
      tailSpread: 0.10, tailLen: 0.22, forkedTail: true,
    },
  },
  {
    id: 'fauna.bird.stormFrigate',
    label: 'Crimson-Pouched Frigatebird',
    notes: 'High-altitude pirate seabird with swept angular wings and deeply forked tail.',
    zones: birdPalette(0x3d3f4a, 0xc93b42, 0x858a94, 0.46),
    spec: {
      torsoR: [0.09, 0.085, 0.20], wingSpan: 0.72, wingChord: 0.15, wingSweep: 0.14,
      neckOffset: [0, 0.04, 0.08], headR: [0.058, 0.055, 0.068],
      beakPts: [[0, -0.004, 0.075], [0, -0.026, 0.135]], beakRadii: [0.022, 0.015, 0.005],
      tailSpread: 0.13, tailLen: 0.28, forkedTail: true,
    },
  },

  // ---- dune (5 endemic species) ----
  {
    id: 'fauna.bird.duneVulture',
    label: 'Sun-Baked Griffon Vulture',
    notes: 'Desert thermal scavenger riding hot updrafts in lazy figure-eights above badland mesas.',
    zones: birdPalette(0x785c45, 0xc9b49b, 0x8f7a68, 0.62),
    spec: {
      torsoR: [0.115, 0.10, 0.23], wingSpan: 0.68, wingChord: 0.23, wingSweep: 0.06,
      neckOffset: [0, 0.03, 0.10], headR: [0.058, 0.055, 0.070],
      beakPts: [[0, -0.006, 0.06], [0, -0.042, 0.098]], beakRadii: [0.028, 0.020, 0.006],
      tailSpread: 0.14, tailLen: 0.20,
    },
  },
  {
    id: 'fauna.bird.oasisSwallow',
    label: 'Copper Oasis Swallow',
    notes: 'Swift aerial insectivore banking around date-palm oases and desert wadis.',
    zones: birdPalette(0x4c688a, 0xc97848, 0x3b3634, 0.48),
    spec: {
      torsoR: [0.062, 0.056, 0.125], wingSpan: 0.34, wingChord: 0.10, wingSweep: 0.10,
      neckOffset: [0, 0.03, 0.045], headR: [0.048, 0.045, 0.054],
      beakPts: [[0, -0.003, 0.032], [0, -0.006, 0.055]], beakRadii: [0.018, 0.011, 0.004],
      tailSpread: 0.09, tailLen: 0.19, forkedTail: true,
    },
  },
  {
    id: 'fauna.bird.sandGrouse',
    label: 'Pin-Tailed Sandgrouse',
    notes: 'Camouflaged ochre flock bird commuting in tight formations between desert scrub and oases.',
    zones: birdPalette(0xc49a64, 0x7d5d3b, 0x594736, 0.64),
    spec: {
      torsoR: [0.088, 0.082, 0.17], wingSpan: 0.40, wingChord: 0.14, wingSweep: 0.08,
      neckOffset: [0, 0.04, 0.06], headR: [0.054, 0.052, 0.060],
      beakPts: [[0, -0.004, 0.038], [0, -0.010, 0.065]], beakRadii: [0.020, 0.012, 0.004],
      tailSpread: 0.08, tailLen: 0.22,
    },
  },
  {
    id: 'fauna.bird.canyonFalcon',
    label: 'Lanner Canyon Falcon',
    notes: 'High-speed desert raptor patrolling sandstone spires with swept pointed wings.',
    zones: birdPalette(0x6d6862, 0xdbcbb8, 0xd9a638, 0.50),
    spec: {
      torsoR: [0.086, 0.080, 0.18], wingSpan: 0.50, wingChord: 0.14, wingSweep: 0.13,
      neckOffset: [0, 0.04, 0.065], headR: [0.058, 0.056, 0.066],
      beakPts: [[0, -0.006, 0.045], [0, -0.036, 0.072]], beakRadii: [0.024, 0.016, 0.005],
      tailSpread: 0.10, tailLen: 0.21,
    },
  },
  {
    id: 'fauna.bird.mirageIbis',
    label: 'Bronze Wadi Ibis',
    notes: 'Crested desert ibis with long decurved bill flying in V-skeins between oasis groves.',
    zones: birdPalette(0x8c563c, 0x4f6b5e, 0xb87648, 0.52),
    spec: {
      torsoR: [0.092, 0.085, 0.19], wingSpan: 0.54, wingChord: 0.17, wingSweep: 0.07,
      neckOffset: [0, 0.045, 0.14], headR: [0.054, 0.052, 0.064],
      beakPts: [[0, -0.012, 0.085], [0, -0.055, 0.165]], beakRadii: [0.022, 0.014, 0.005],
      tailSpread: 0.10, tailLen: 0.15, crestHeight: 0.055, trailingLegs: 0.24,
    },
  },
];

for (const entry of BIRD_SPECIES) {
  register({
    id: entry.id,
    label: entry.label,
    category: 'fauna',
    biosphere: true,
    footprint: [1, 1],
    snap: false,
    zones: entry.zones,
    notes: entry.notes,
    build: (b) => buildAvianBody(b, entry.spec),
  });
}
