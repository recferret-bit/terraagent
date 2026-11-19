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

function warmPalette(coat: number, underbelly: number, darkJoint: number, roughness = 0.68): Partial<Record<MaterialZoneId, MaterialZoneSpec>> {
  return {
    hullPrimary: surface(coat, roughness),
    hullSecondary: surface(underbelly, Math.min(0.85, roughness + 0.06)),
    frameGunmetal: surface(darkJoint, 0.72),
    rubberDark: surface(0x3a322d, 0.78),
    glassVisor: surface(0x1b1815, 0.16),
  };
}

interface MammalRigSpec {
  torsoX: number;
  torsoY: number;
  chestZ: number;
  rumpZ: number;
  chestR: V3;
  rumpR: V3;
  legThick: number;
  hoof?: boolean;
  neckRise: V3;
  headSize: V3;
  snoutLen: number;
  earSize: V3;
  earTilt?: number;
  tailPts: V3[];
  tailRadii: number[];
}

function addMammalHeadAndNeck(b: KitbashBuilder, s: MammalRigSpec): { neckPivot: V3; headCenter: V3; headAnim: PartOptions } {
  const neckPivot: V3 = [0, s.torsoY + s.chestR[1] * 0.32, s.chestZ + s.chestR[2] * 0.78];
  const headAnim: PartOptions = { animType: 78, animPivot: neckPivot };
  const nR = Math.max(0.044, s.headSize[1] * 0.56);
  b.addPart(organ([s.headSize[0] * 0.70, nR, nR], 2, 4.1, 0, 8), 'hullSecondary', {
    name: 'cervical base',
    position: neckPivot,
    ...headAnim,
  });

  const headCenter: V3 = [
    neckPivot[0] + s.neckRise[0],
    neckPivot[1] + s.neckRise[1],
    neckPivot[2] + s.neckRise[2],
  ];
  const ndx = headCenter[0] - neckPivot[0];
  const ndy = headCenter[1] - neckPivot[1];
  const ndz = headCenter[2] - neckPivot[2];
  const nLen = Math.max(0.06, Math.hypot(ndx, ndy, ndz));
  if (nLen > nR * 0.85 + s.headSize[2] * 0.85) {
    const neckStart: V3 = [
      neckPivot[0] + (ndx / nLen) * (nR * 0.72),
      neckPivot[1] + (ndy / nLen) * (nR * 0.72),
      neckPivot[2] + (ndz / nLen) * (nR * 0.72),
    ];
    const neckEnd: V3 = [
      headCenter[0] - (ndx / nLen) * (s.headSize[2] * 0.48),
      headCenter[1] - (ndy / nLen) * (s.headSize[1] * 0.48),
      headCenter[2] - (ndz / nLen) * (s.headSize[2] * 0.48),
    ];
    b.addPart(
      tendril(
        [
          neckStart,
          [(neckStart[0] + neckEnd[0]) * 0.5, (neckStart[1] + neckEnd[1]) * 0.5, (neckStart[2] + neckEnd[2]) * 0.5],
          neckEnd,
        ],
        [nR * 0.80, nR * 0.74, nR * 0.66],
        1,
        5,
        6,
      ),
      'hullPrimary',
      { name: 'muscular neck', ...headAnim },
    );
  }

  b.addPart(organ(s.headSize, 1, 5.2, 0.01, 9), 'hullPrimary', {
    name: 'cranium',
    position: headCenter,
    ...headAnim,
  });

  const snoutZ = headCenter[2] + s.headSize[2] * 0.78 + s.snoutLen * 0.42;
  const snoutY = headCenter[1] - s.headSize[1] * 0.16;
  b.addPart(
    organ([s.headSize[0] * 0.56, s.headSize[1] * 0.54, s.snoutLen * 0.58], 2, 6.1, 0, 8),
    'hullSecondary',
    { name: 'muzzle', position: [0, snoutY, snoutZ], ...headAnim },
  );
  b.addPart(
    organ([s.headSize[0] * 0.22, s.headSize[1] * 0.20, 0.025], 5, 0, 0, 6),
    'glassVisor',
    { name: 'rhinarium nose', position: [0, snoutY + 0.01, snoutZ + s.snoutLen * 0.52], ...headAnim },
  );

  for (const side of [-1, 1] as const) {
    const dir = side > 0 ? 'right' : 'left';
    b.addPart(organ([0.022, 0.022, 0.026], 5, side, 0, 6), 'glassVisor', {
      name: `${dir} eye`,
      position: [s.headSize[0] * 0.84 * side, headCenter[1] + s.headSize[1] * 0.16, headCenter[2] + s.headSize[2] * 0.35],
      ...headAnim,
    });
    b.addPart(organ(s.earSize, 2, side + 2, 0, 7), 'frameGunmetal', {
      name: `${dir} pinna ear`,
      position: [
        s.headSize[0] * 0.68 * side,
        headCenter[1] + s.headSize[1] * 0.78 + s.earSize[1] * 0.42,
        headCenter[2] - s.headSize[2] * 0.18,
      ],
      rotation: [s.earTilt ?? 0.14, 0, -side * 0.22],
      ...headAnim,
    });
  }
  return { neckPivot, headCenter, headAnim };
}

function addMammalTail(b: KitbashBuilder, s: MammalRigSpec): void {
  const tailPivot: V3 = [0, s.torsoY + s.rumpR[1] * 0.20, s.rumpZ - s.rumpR[2] * 0.82];
  const tailAnim: PartOptions = { animType: 88, animPivot: tailPivot };
  const tR = Math.max(0.026, s.tailRadii[0]! * 1.05);
  b.addPart(organ([tR, tR * 0.95, tR], 2, 7.1, 0, 6), 'hullPrimary', {
    name: 'caudal base',
    position: tailPivot,
    ...tailAnim,
  });
  const tailStart: V3 = [tailPivot[0], tailPivot[1], tailPivot[2] - tR * 0.70];
  b.addPart(tendril([tailStart, ...s.tailPts], s.tailRadii, 1, 6, 6), 'hullSecondary', {
    name: 'tail',
    role: 'whip',
    ...tailAnim,
  });
}

function buildMammalCore(b: KitbashBuilder, s: MammalRigSpec): { neckPivot: V3; headCenter: V3; headAnim: PartOptions } {
  const bodyAnim: PartOptions = { animType: 8 };
  const legHx = s.torsoX - s.legThick * 0.25;
  const legHy = s.torsoY - s.chestR[1] * 0.18;

  b.addGreeble('organicQuadLegs', {
    hx: legHx,
    hy: legHy,
    zFront: s.chestZ + s.chestR[2] * 0.35,
    zBack: s.rumpZ - s.rumpR[2] * 0.25,
    thickness: s.legThick,
    hoof: s.hoof,
  });

  b.addPart(organ(s.chestR, 1, 1.1, 0.014, 10), 'hullPrimary', {
    name: 'thoracic ribcage',
    position: [0, s.torsoY, s.chestZ],
    ...bodyAnim,
  });
  b.addPart(organ(s.rumpR, 1, 2.3, 0.012, 10), 'hullPrimary', {
    name: 'pelvic haunches',
    position: [0, s.torsoY - 0.01, s.rumpZ],
    ...bodyAnim,
  });
  const midZ = (s.chestZ + s.rumpZ) * 0.5;
  const spanZ = Math.max(0.10, (s.chestZ - s.rumpZ) * 0.42);
  b.addPart(
    organ([s.torsoX * 0.84, s.chestR[1] * 0.82, spanZ], 2, 3.4, 0.01, 9),
    'hullSecondary',
    { name: 'ventral flank', position: [0, s.torsoY - s.chestR[1] * 0.14, midZ], ...bodyAnim },
  );

  const head = addMammalHeadAndNeck(b, s);
  addMammalTail(b, s);
  return head;
}

// ---------------------------------------------------------------------------
// BIOME 1: forestRock (Highland / Boreal-Montane — 4 warm-blooded species)
// ---------------------------------------------------------------------------
register({
  id: 'fauna.timberWolf',
  label: 'Highland Timber Wolf',
  category: 'fauna',
  biosphere: true,
  footprint: [1, 1],
  zones: warmPalette(0x5d6470, 0xb8bec6, 0x3b4048, 0.70),
  notes: 'Pack hunter of boreal crags; thick slate pelage, pointed ears, bushy counterbalance tail.',
  build: (b) => {
    buildMammalCore(b, {
      torsoX: 0.17, torsoY: 0.48, chestZ: 0.20, rumpZ: -0.22,
      chestR: [0.17, 0.16, 0.22], rumpR: [0.15, 0.15, 0.20], legThick: 0.036,
      neckRise: [0, 0.14, 0.13], headSize: [0.11, 0.10, 0.13], snoutLen: 0.13,
      earSize: [0.035, 0.065, 0.025],
      tailPts: [[0, 0.46, -0.56], [0, 0.34, -0.74], [0, 0.26, -0.86]],
      tailRadii: [0.042, 0.055, 0.048, 0.018],
    });
  },
});

register({
  id: 'fauna.crownStag',
  label: 'Boreal Crown Stag',
  category: 'fauna',
  biosphere: true,
  footprint: [1, 1],
  zones: warmPalette(0x8c5e3c, 0xc9ab88, 0x4f3624, 0.66),
  notes: 'Herd herbivore grazing highland meadows and forest edges; palmate branching antlers and cloven hooves.',
  build: (b) => {
    const { neckPivot, headCenter } = buildMammalCore(b, {
      torsoX: 0.20, torsoY: 0.68, chestZ: 0.24, rumpZ: -0.26,
      chestR: [0.20, 0.19, 0.25], rumpR: [0.19, 0.18, 0.24], legThick: 0.036, hoof: true,
      neckRise: [0, 0.26, 0.16], headSize: [0.10, 0.10, 0.14], snoutLen: 0.13,
      earSize: [0.032, 0.075, 0.024], earTilt: -0.18,
      tailPts: [[0, 0.70, -0.56], [0, 0.63, -0.64]],
      tailRadii: [0.034, 0.028, 0.012],
    });
    b.addGreeble('cervineAntlers', {
      neckPivot,
      brow: [0.055, headCenter[1] + 0.07, headCenter[2] - 0.01],
      spread: 0.22,
      height: 0.34,
      tines: 2,
    });
  },
});

register({
  id: 'fauna.cragUrsine',
  label: 'Montane Crag Ursine',
  category: 'fauna',
  biosphere: true,
  footprint: [1, 1],
  zones: warmPalette(0x5c4332, 0x7c5e48, 0x3a2a1f, 0.74),
  notes: 'Solitary heavy omnivore/predator of rocky ridges; muscular scapular hump and broad paws.',
  build: (b) => {
    buildMammalCore(b, {
      torsoX: 0.27, torsoY: 0.56, chestZ: 0.24, rumpZ: -0.26,
      chestR: [0.27, 0.24, 0.28], rumpR: [0.26, 0.23, 0.27], legThick: 0.056,
      neckRise: [0, 0.08, 0.16], headSize: [0.15, 0.14, 0.16], snoutLen: 0.12,
      earSize: [0.042, 0.042, 0.028],
      tailPts: [[0, 0.56, -0.58], [0, 0.52, -0.65]],
      tailRadii: [0.045, 0.038, 0.020],
    });
    b.addPart(organ([0.18, 0.065, 0.15], 1, 8.4, 0.01, 8), 'hullSecondary', {
      name: 'scapular muscle hump',
      position: [0, 0.84, 0.22],
      animType: 8,
    });
  },
});

register({
  id: 'fauna.meadowHare',
  label: 'Alpine Meadow Hare',
  category: 'fauna',
  biosphere: true,
  footprint: [1, 1],
  zones: warmPalette(0x9e8b74, 0xdcd3c6, 0x6b5c4c, 0.72),
  notes: 'Small fast grass-eating lagomorph living in meadow warrens; long upright ears and cotton tail.',
  build: (b) => {
    buildMammalCore(b, {
      torsoX: 0.11, torsoY: 0.26, chestZ: 0.10, rumpZ: -0.11,
      chestR: [0.11, 0.10, 0.13], rumpR: [0.12, 0.11, 0.14], legThick: 0.024,
      neckRise: [0, 0.08, 0.08], headSize: [0.075, 0.072, 0.088], snoutLen: 0.055,
      earSize: [0.026, 0.115, 0.020], earTilt: -0.16,
      tailPts: [[0, 0.30, -0.31], [0, 0.34, -0.36]],
      tailRadii: [0.028, 0.036, 0.020],
    });
  },
});

// ---------------------------------------------------------------------------
// BIOME 2: oceanForest (Tropical Archipelago / Rainforest — 4 warm-blooded species)
// ---------------------------------------------------------------------------
register({
  id: 'fauna.canopyPanther',
  label: 'Emerald Canopy Panther',
  category: 'fauna',
  biosphere: true,
  footprint: [1, 1],
  zones: warmPalette(0x3f4352, 0x676d82, 0x2c2f3a, 0.56),
  notes: 'Solitary twilight predator stalking tropical jungle clearings; sleek muscular frame and long curling tail.',
  build: (b) => {
    buildMammalCore(b, {
      torsoX: 0.16, torsoY: 0.46, chestZ: 0.22, rumpZ: -0.24,
      chestR: [0.16, 0.15, 0.24], rumpR: [0.15, 0.15, 0.22], legThick: 0.038,
      neckRise: [0, 0.10, 0.14], headSize: [0.11, 0.10, 0.12], snoutLen: 0.085,
      earSize: [0.032, 0.038, 0.024],
      tailPts: [[0, 0.44, -0.60], [0, 0.32, -0.82], [0, 0.36, -0.98]],
      tailRadii: [0.032, 0.028, 0.024, 0.014],
    });
  },
});

register({
  id: 'fauna.reefTapir',
  label: 'Archipelago Saddleback Tapir',
  category: 'fauna',
  biosphere: true,
  footprint: [1, 1],
  zones: warmPalette(0x524946, 0xd4cfc7, 0x3b3432, 0.64),
  notes: 'Browsing herbivore feeding on coastal ferns, mangroves and understory shoots; prehensile snout.',
  build: (b) => {
    const { headCenter, headAnim } = buildMammalCore(b, {
      torsoX: 0.22, torsoY: 0.48, chestZ: 0.20, rumpZ: -0.22,
      chestR: [0.21, 0.19, 0.24], rumpR: [0.22, 0.20, 0.25], legThick: 0.044, hoof: true,
      neckRise: [0, 0.07, 0.14], headSize: [0.12, 0.12, 0.15], snoutLen: 0.11,
      earSize: [0.034, 0.044, 0.024],
      tailPts: [[0, 0.45, -0.50], [0, 0.39, -0.56]],
      tailRadii: [0.032, 0.024, 0.012],
    });
    b.addPart(
      tendril(
        [
          [0, headCenter[1] - 0.02, headCenter[2] + 0.18],
          [0, headCenter[1] - 0.08, headCenter[2] + 0.27],
          [0, headCenter[1] - 0.14, headCenter[2] + 0.31],
        ],
        [0.048, 0.038, 0.024],
        2,
        5,
        6,
      ),
      'hullPrimary',
      { name: 'prehensile proboscis', role: 'whip', ...headAnim },
    );
  },
});

register({
  id: 'fauna.lagoonCapybara',
  label: 'Lagoon Giant Capybara',
  category: 'fauna',
  biosphere: true,
  footprint: [1, 1],
  zones: warmPalette(0x8f6845, 0xa8825c, 0x593f28, 0.74),
  notes: 'Semi-aquatic herd grazer feeding on shoreline reeds and sedges around island lagoons.',
  build: (b) => {
    buildMammalCore(b, {
      torsoX: 0.18, torsoY: 0.36, chestZ: 0.16, rumpZ: -0.17,
      chestR: [0.18, 0.16, 0.20], rumpR: [0.19, 0.17, 0.21], legThick: 0.034,
      neckRise: [0, 0.06, 0.11], headSize: [0.11, 0.11, 0.13], snoutLen: 0.09,
      earSize: [0.026, 0.028, 0.020],
      tailPts: [[0, 0.35, -0.40], [0, 0.32, -0.44]],
      tailRadii: [0.028, 0.020, 0.012],
    });
  },
});

register({
  id: 'fauna.islandLemur',
  label: 'Ring-Tailed Canopy Lemur',
  category: 'fauna',
  biosphere: true,
  footprint: [1, 1],
  zones: warmPalette(0x7d8088, 0xe2e4e8, 0x3b3e45, 0.68),
  notes: 'Social troop browser foraging fruit and blossoms around banyan and palm stands; tall arched tail.',
  build: (b) => {
    buildMammalCore(b, {
      torsoX: 0.11, torsoY: 0.30, chestZ: 0.12, rumpZ: -0.13,
      chestR: [0.11, 0.10, 0.14], rumpR: [0.11, 0.10, 0.14], legThick: 0.024,
      neckRise: [0, 0.09, 0.09], headSize: [0.078, 0.075, 0.085], snoutLen: 0.055,
      earSize: [0.030, 0.038, 0.020],
      tailPts: [[0, 0.42, -0.34], [0, 0.58, -0.42], [0, 0.66, -0.34]],
      tailRadii: [0.028, 0.032, 0.030, 0.018],
    });
  },
});

// ---------------------------------------------------------------------------
// BIOME 3: dune (Arid Desert / Badlands / Oasis — 4 warm-blooded species)
// ---------------------------------------------------------------------------
register({
  id: 'fauna.duneJackal',
  label: 'Golden Dune Jackal',
  category: 'fauna',
  biosphere: true,
  footprint: [1, 1],
  zones: warmPalette(0xc49456, 0xe6cfa8, 0x6e5130, 0.68),
  notes: 'Crepuscular desert pack hunter with oversized heat-radiating ears and sandy-gold coat.',
  build: (b) => {
    buildMammalCore(b, {
      torsoX: 0.14, torsoY: 0.44, chestZ: 0.18, rumpZ: -0.20,
      chestR: [0.14, 0.14, 0.20], rumpR: [0.13, 0.13, 0.19], legThick: 0.030,
      neckRise: [0, 0.13, 0.12], headSize: [0.095, 0.090, 0.115], snoutLen: 0.12,
      earSize: [0.042, 0.088, 0.024],
      tailPts: [[0, 0.41, -0.50], [0, 0.30, -0.66], [0, 0.24, -0.76]],
      tailRadii: [0.036, 0.046, 0.040, 0.016],
    });
  },
});

register({
  id: 'fauna.saberOryx',
  label: 'White Saber Oryx',
  category: 'fauna',
  biosphere: true,
  footprint: [1, 1],
  zones: warmPalette(0xdcd3c4, 0x8c6d53, 0x45382e, 0.62),
  notes: 'Desert antelope herd browser adapted to dry acacia scrub; long swept-back keratin horns.',
  build: (b) => {
    const { neckPivot, headCenter } = buildMammalCore(b, {
      torsoX: 0.19, torsoY: 0.66, chestZ: 0.23, rumpZ: -0.25,
      chestR: [0.19, 0.19, 0.25], rumpR: [0.18, 0.18, 0.23], legThick: 0.035, hoof: true,
      neckRise: [0, 0.22, 0.16], headSize: [0.10, 0.10, 0.14], snoutLen: 0.12,
      earSize: [0.030, 0.072, 0.022], earTilt: -0.20,
      tailPts: [[0, 0.62, -0.56], [0, 0.44, -0.66]],
      tailRadii: [0.028, 0.022, 0.030],
    });
    b.addGreeble('sweptHorns', {
      neckPivot,
      brow: [0.045, headCenter[1] + 0.07, headCenter[2] - 0.02],
      length: 0.42,
      sweepBack: 0.38,
      flare: 0.06,
    });
  },
});

register({
  id: 'fauna.mesaCaracal',
  label: 'Red Mesa Caracal',
  category: 'fauna',
  biosphere: true,
  footprint: [1, 1],
  zones: warmPalette(0xb86d3c, 0xe3ba96, 0x472d1e, 0.64),
  notes: 'Solitary desert ambush feline patrolling sandstone mesas; tall black-tufted ears.',
  build: (b) => {
    buildMammalCore(b, {
      torsoX: 0.14, torsoY: 0.42, chestZ: 0.18, rumpZ: -0.20,
      chestR: [0.14, 0.13, 0.20], rumpR: [0.13, 0.13, 0.19], legThick: 0.031,
      neckRise: [0, 0.11, 0.11], headSize: [0.095, 0.092, 0.10], snoutLen: 0.07,
      earSize: [0.028, 0.078, 0.020],
      tailPts: [[0, 0.42, -0.48], [0, 0.35, -0.62]],
      tailRadii: [0.028, 0.024, 0.015],
    });
  },
});

register({
  id: 'fauna.oasisCamelid',
  label: 'Oasis Dromedary Camelid',
  category: 'fauna',
  biosphere: true,
  footprint: [1, 1],
  zones: warmPalette(0xc79b63, 0xa87d4a, 0x63482a, 0.74),
  notes: 'Desert caravan herbivore browsing oasis palms, dry snags and thorny cactuses; dorsal fat-reserve hump.',
  build: (b) => {
    buildMammalCore(b, {
      torsoX: 0.22, torsoY: 0.78, chestZ: 0.24, rumpZ: -0.26,
      chestR: [0.22, 0.21, 0.26], rumpR: [0.20, 0.20, 0.24], legThick: 0.040, hoof: true,
      neckRise: [0, 0.32, 0.24], headSize: [0.11, 0.10, 0.15], snoutLen: 0.12,
      earSize: [0.028, 0.042, 0.022],
      tailPts: [[0, 0.74, -0.58], [0, 0.56, -0.66]],
      tailRadii: [0.030, 0.022, 0.028],
    });
    b.addPart(organ([0.16, 0.16, 0.22], 1, 9.2, 0.015, 9), 'hullSecondary', {
      name: 'dorsal fat hump',
      position: [0, 1.04, -0.02],
      animType: 8,
    });
  },
});
