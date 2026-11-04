import { FAUNA_SPECIES_ZONES } from '../../faunaVisualRegistry';
import { type KitbashBuilder } from '../../KitbashRegistry';
import { box } from '../../greebles/faunaGreebles';
import { rbox, cyl, sph, cable, mirror, type V3 } from '../../greebles/unitParts';
import { register } from './common';

const SPIDER_BODY = { animType: 9 as const };

// ---------------------------------------------------------------------------
// 1. fauna.blackAnt — Charcoal-black melee horde ant (~1.3m, radius 0.3 tiles)
// ---------------------------------------------------------------------------

function addBlackAntThoraxAndGaster(b: KitbashBuilder): void {
  b.addPart(rbox(0.42, 0.24, 0.64, 0.07, 1), 'hullPrimary', {
    name: 'body thorax carapace', position: [0, 0.66, 0.02], ...SPIDER_BODY,
  });
  b.addPart(box(0.32, 0.07, 0.48), 'frameGunmetal', {
    name: 'body thorax sternum', position: [0, 0.52, 0.02], ...SPIDER_BODY,
  });
  b.addPart(box(0.32, 0.055, 0.24), 'hullSecondary', {
    name: 'thorax pronotum plate', position: [0, 0.79, 0.16], ...SPIDER_BODY,
  });
  b.addPart(box(0.28, 0.05, 0.22), 'hullSecondary', {
    name: 'thorax mesonotum ridge', position: [0, 0.785, -0.12], ...SPIDER_BODY,
  });
  b.addPart(sph(0.095, 8, 6), 'frameGunmetal', {
    name: 'waist petiole node', position: [0, 0.65, -0.32], ...SPIDER_BODY,
  });
  b.addPart(rbox(0.20, 0.15, 0.16, 0.04, 1), 'hullSecondary', {
    name: 'waist postpetiole crest', position: [0, 0.68, -0.42], ...SPIDER_BODY,
  });
  b.addPart(rbox(0.52, 0.32, 0.56, 0.09, 1), 'hullPrimary', {
    name: 'body gaster carapace', position: [0, 0.75, -0.72], rotation: [0.14, 0, 0], ...SPIDER_BODY,
  });
  b.addPart(box(0.38, 0.06, 0.40), 'frameGunmetal', {
    name: 'body gaster sternite', position: [0, 0.58, -0.72], rotation: [0.14, 0, 0], ...SPIDER_BODY,
  });
  b.addPart(box(0.42, 0.055, 0.15), 'hullSecondary', {
    name: 'gaster tergite band A', position: [0, 0.90, -0.57], rotation: [0.14, 0, 0], ...SPIDER_BODY,
  });
  b.addPart(box(0.40, 0.055, 0.15), 'hullSecondary', {
    name: 'gaster tergite band B', position: [0, 0.93, -0.79], rotation: [0.14, 0, 0], ...SPIDER_BODY,
  });
  mirror((s) => {
    b.addPart(box(0.04, 0.14, 0.36), 'hullSecondary', {
      name: 'gaster flank chitin plate', position: [0.265 * s, 0.75, -0.72], rotation: [0.14, 0, 0], ...SPIDER_BODY,
    });
  });
  b.addPart(box(0.08, 0.09, 0.14), 'frameGunmetal', {
    name: 'gaster chitin scar spur', position: [0.14, 0.94, -0.68], rotation: [0.2, 0, -0.25], ...SPIDER_BODY,
  });
  b.addPart(box(0.26, 0.14, 0.08), 'hullSecondary', {
    name: 'gaster rear tergite cap', position: [0, 0.78, -1.00], ...SPIDER_BODY,
  });
  b.addPart(sph(0.048, 8, 6), 'warningAmber', {
    name: 'gaster stinger gland light', position: [0, 0.78, -1.05], emissiveIntensity: 3.6, ...SPIDER_BODY,
  });
}

function addBlackAntHeadAndMandibles(b: KitbashBuilder): void {
  b.addPart(sph(0.09, 8, 6), 'frameGunmetal', {
    name: 'neck cervix joint', position: [0, 0.66, 0.36], ...SPIDER_BODY,
  });
  b.addPart(rbox(0.40, 0.22, 0.28, 0.06, 1), 'hullPrimary', {
    name: 'body head capsule', position: [0, 0.68, 0.50], ...SPIDER_BODY,
  });
  b.addPart(box(0.26, 0.05, 0.16), 'hullSecondary', {
    name: 'head vertex crest plate', position: [0, 0.80, 0.49], ...SPIDER_BODY,
  });
  mirror((s) => {
    b.addPart(sph(0.050, 8, 6), 'dangerCrimson', {
      name: 'sensor compound eye light', position: [0.20 * s, 0.74, 0.48], emissiveIntensity: 4.2, ...SPIDER_BODY,
    });
    cable(
      b,
      [[0.11 * s, 0.76, 0.55], [0.24 * s, 0.96, 0.70], [0.32 * s, 0.90, 0.88]] as V3[],
      0.013,
      'frameGunmetal',
      { name: 'sensor antenna whip', role: 'whip', ...SPIDER_BODY },
    );
  });

  const jawAnim = { animType: 39 as const, animPivot: [0, 0.63, 0.64] as V3 };
  mirror((s) => {
    b.addPart(cyl(0.046, 0.052, 0.12, 8), 'frameGunmetal', {
      name: 'head mandible socket mount', position: [0.11 * s, 0.63, 0.64], rotation: [Math.PI / 2, 0, 0], ...SPIDER_BODY,
    });
    b.addPart(cyl(0.032, 0.036, 0.28, 8), 'hullSecondary', {
      name: 'claw mandible blade', position: [0.11 * s, 0.63, 0.76], rotation: [Math.PI / 2, 0, 0], ...jawAnim,
    });
    b.addPart(rbox(0.07, 0.05, 0.12, 0.015, 1), 'hullSecondary', {
      name: 'claw mandible fang tip', position: [0.075 * s, 0.63, 0.90], rotation: [0, -0.45 * s, 0], ...jawAnim,
    });
  });
}

register({
  id: 'fauna.blackAnt',
  label: 'Black Ant',
  category: 'fauna',
  footprint: [1, 1],
  zones: FAUNA_SPECIES_ZONES.blackAnt,
  notes:
    'Charcoal-slate chitin ant: narrow petiole waist, 6 grounded hooked legs (animType 6/16), recoiling serrated mandibles (animType 39), elbowed antennae, crimson eyes.',
  build: (b) => {
    b.addGreeble('bugSixLegs', {
      hx: 0.25, hy: 0.60, zPairs: [0.32, 0.02, -0.26],
      footSpreadX: 0.09, footSpreadZ: 1.54,
      rHip: 0.088, rFemur: 0.030, rKnee: 0.066, rTibia: 0.022, rFoot: 0.068,
    });
    addBlackAntThoraxAndGaster(b);
    addBlackAntHeadAndMandibles(b);
  },
});

// ---------------------------------------------------------------------------
// 2. fauna.blueBeetle — Huge cobalt armored tank beetle (~1.9m, radius 0.8 tiles)
// ---------------------------------------------------------------------------

function addBlueBeetleCarapace(b: KitbashBuilder): void {
  b.addPart(rbox(0.74, 0.20, 1.08, 0.06, 1), 'frameGunmetal', {
    name: 'body lower plastron', position: [0, 0.54, -0.04], ...SPIDER_BODY,
  });
  b.addPart(rbox(0.86, 0.34, 1.04, 0.10, 1), 'hullPrimary', {
    name: 'body elytra carapace', position: [0, 0.74, -0.12], ...SPIDER_BODY,
  });
  b.addPart(box(0.14, 0.07, 0.88), 'frameGunmetal', {
    name: 'carapace dorsal suture spine', position: [0, 0.93, -0.12], ...SPIDER_BODY,
  });
  mirror((s) => {
    b.addPart(rbox(0.30, 0.06, 0.76, 0.02, 1), 'hullSecondary', {
      name: 'carapace elytra dorsal plate', position: [0.25 * s, 0.92, -0.12], rotation: [0, 0, -0.10 * s], ...SPIDER_BODY,
    });
    b.addPart(box(0.16, 0.04, 0.18), 'frameGunmetal', {
      name: 'carapace dorsal rib stud', position: [0.26 * s, 0.955, 0.06 * s], rotation: [0, 0, -0.10 * s], ...SPIDER_BODY,
    });
    b.addPart(box(0.05, 0.12, 0.78), 'hullSecondary', {
      name: 'carapace flank ridge plate', position: [0.435 * s, 0.80, -0.12], ...SPIDER_BODY,
    });
    b.addPart(sph(0.055, 8, 6), 'energyCyan', {
      name: 'carapace spiracle pore light', position: [0.22 * s, 0.76, -0.68], emissiveIntensity: 4.0, ...SPIDER_BODY,
    });
  });
  b.addPart(box(0.58, 0.16, 0.08), 'hullSecondary', {
    name: 'carapace rear pygidium plate', position: [0, 0.72, -0.65], ...SPIDER_BODY,
  });
}

function addBlueBeetlePronotumAndHorn(b: KitbashBuilder): void {
  b.addPart(rbox(0.76, 0.28, 0.40, 0.08, 1), 'hullPrimary', {
    name: 'body pronotum shield', position: [0, 0.72, 0.52], ...SPIDER_BODY,
  });
  b.addPart(box(0.52, 0.06, 0.24), 'hullSecondary', {
    name: 'pronotum crown plate', position: [0, 0.87, 0.50], ...SPIDER_BODY,
  });
  mirror((s) => {
    b.addPart(sph(0.056, 8, 6), 'energyCyan', {
      name: 'sensor compound eye light', position: [0.32 * s, 0.78, 0.68], emissiveIntensity: 4.2, ...SPIDER_BODY,
    });
  });

  const hornAnim = { animType: 39 as const, animPivot: [0, 0.70, 0.72] as V3 };
  b.addPart(cyl(0.11, 0.13, 0.14, 8), 'frameGunmetal', {
    name: 'pronotum horn collar mount', position: [0, 0.70, 0.74], rotation: [Math.PI / 2, 0, 0], ...SPIDER_BODY,
  });
  b.addPart(cyl(0.075, 0.085, 0.36, 8), 'hullSecondary', {
    name: 'ram gore horn shaft', position: [0, 0.70, 0.90], rotation: [Math.PI / 2, 0, 0], ...hornAnim,
  });
  b.addPart(rbox(0.24, 0.10, 0.20, 0.03, 1), 'hullSecondary', {
    name: 'ram horn crown blade', position: [0, 0.74, 1.08], rotation: [-0.28, 0, 0], ...hornAnim,
  });
  mirror((s) => {
    b.addPart(box(0.08, 0.07, 0.16), 'hullSecondary', {
      name: 'claw horn prong tip', position: [0.11 * s, 0.80, 1.18], rotation: [-0.35, 0.22 * s, 0], ...hornAnim,
    });
  });
}

register({
  id: 'fauna.blueBeetle',
  label: 'Armored Blue Beetle',
  category: 'fauna',
  footprint: [2, 2],
  zones: FAUNA_SPECIES_ZONES.blueBeetle,
  notes:
    'Heavy cobalt-armored tank beetle: wide overlapping elytra carapace, 6 armored legs (animType 6/16), bifurcated gore horn (animType 39), cyan bio-pores.',
  build: (b) => {
    b.addGreeble('bugSixLegs', {
      hx: 0.42, hy: 0.58, zPairs: [0.40, 0.0, -0.42],
      footSpreadX: 0.12, footSpreadZ: 1.48,
      rHip: 0.105, rFemur: 0.042, rKnee: 0.078, rTibia: 0.030, rFoot: 0.092,
      kneeSpurs: true,
    });
    addBlueBeetleCarapace(b);
    addBlueBeetlePronotumAndHorn(b);
  },
});

// ---------------------------------------------------------------------------
// 3. fauna.greenSpitter — Ranged emerald acid insect (~1.5m, radius 0.4 tiles)
// ---------------------------------------------------------------------------

function addGreenSpitterThoraxAndAbdomen(b: KitbashBuilder): void {
  b.addPart(rbox(0.44, 0.24, 0.62, 0.07, 1), 'hullPrimary', {
    name: 'body thorax carapace', position: [0, 0.66, 0.02], ...SPIDER_BODY,
  });
  b.addPart(box(0.34, 0.07, 0.46), 'frameGunmetal', {
    name: 'body thorax sternum', position: [0, 0.52, 0.02], ...SPIDER_BODY,
  });
  b.addPart(box(0.34, 0.055, 0.24), 'hullSecondary', {
    name: 'thorax dorsal saddle', position: [0, 0.79, 0.15], ...SPIDER_BODY,
  });
  b.addPart(box(0.30, 0.05, 0.20), 'hullSecondary', {
    name: 'thorax rear plate', position: [0, 0.785, -0.12], ...SPIDER_BODY,
  });
  b.addPart(sph(0.095, 8, 6), 'frameGunmetal', {
    name: 'waist pedicel joint', position: [0, 0.72, -0.31], ...SPIDER_BODY,
  });
  b.addPart(rbox(0.50, 0.32, 0.60, 0.09, 1), 'hullPrimary', {
    name: 'body elevated abdomen', position: [0, 0.88, -0.64], rotation: [0.34, 0, 0], ...SPIDER_BODY,
  });
  b.addPart(box(0.36, 0.06, 0.42), 'frameGunmetal', {
    name: 'abdomen belly sternite', position: [0, 0.72, -0.60], rotation: [0.34, 0, 0], ...SPIDER_BODY,
  });
  b.addPart(box(0.40, 0.055, 0.15), 'hullSecondary', {
    name: 'abdomen pressure rib A', position: [0, 1.03, -0.50], rotation: [0.34, 0, 0], ...SPIDER_BODY,
  });
  b.addPart(box(0.38, 0.055, 0.15), 'hullSecondary', {
    name: 'abdomen pressure rib B', position: [0, 1.11, -0.72], rotation: [0.34, 0, 0], ...SPIDER_BODY,
  });
  b.addPart(sph(0.125, 8, 6), 'terraformEmerald', {
    name: 'dorsal acid sac light', position: [0, 1.08, -0.61], emissiveIntensity: 3.8, ...SPIDER_BODY,
  });
  mirror((s) => {
    b.addPart(sph(0.11, 8, 6), 'terraformEmerald', {
      name: 'lateral acid sac light', position: [0.25 * s, 0.94, -0.70], emissiveIntensity: 3.8, ...SPIDER_BODY,
    });
    b.addPart(box(0.045, 0.14, 0.22), 'hullSecondary', {
      name: 'abdomen flank chitin rib', position: [0.255 * s, 0.86, -0.52], rotation: [0.34, 0, 0], ...SPIDER_BODY,
    });
  });
  b.addPart(sph(0.08, 8, 6), 'terraformEmerald', {
    name: 'asymmetric venom gland light', position: [0.18, 1.12, -0.80], emissiveIntensity: 4.0, ...SPIDER_BODY,
  });
  b.addPart(box(0.28, 0.15, 0.08), 'hullSecondary', {
    name: 'abdomen rear valve plate', position: [0, 0.98, -0.94], rotation: [0.34, 0, 0], ...SPIDER_BODY,
  });
  b.addPart(sph(0.09, 8, 6), 'terraformEmerald', {
    name: 'tail acid reservoir light', position: [0, 1.02, -1.01], emissiveIntensity: 4.0, ...SPIDER_BODY,
  });
}

function addGreenSpitterHeadAndNozzle(b: KitbashBuilder): void {
  b.addPart(sph(0.09, 8, 6), 'frameGunmetal', {
    name: 'neck cervix joint', position: [0, 0.66, 0.35], ...SPIDER_BODY,
  });
  b.addPart(rbox(0.40, 0.22, 0.28, 0.06, 1), 'hullPrimary', {
    name: 'body head capsule', position: [0, 0.68, 0.49], ...SPIDER_BODY,
  });
  b.addPart(box(0.26, 0.05, 0.16), 'hullSecondary', {
    name: 'head brow shield plate', position: [0, 0.80, 0.48], ...SPIDER_BODY,
  });
  mirror((s) => {
    b.addPart(sph(0.050, 8, 6), 'warningAmber', {
      name: 'sensor compound eye light', position: [0.20 * s, 0.74, 0.48], emissiveIntensity: 3.8, ...SPIDER_BODY,
    });
    cable(
      b,
      [[0.12 * s, 0.76, 0.54], [0.24 * s, 0.92, 0.66], [0.28 * s, 0.86, 0.80]] as V3[],
      0.012,
      'frameGunmetal',
      { name: 'sensor antenna palp', role: 'whip', ...SPIDER_BODY },
    );
  });

  const nozzleAnim = { animType: 39 as const, animPivot: [0, 0.64, 0.63] as V3 };
  b.addPart(cyl(0.095, 0.11, 0.12, 8), 'frameGunmetal', {
    name: 'head nozzle collar mount', position: [0, 0.64, 0.65], rotation: [Math.PI / 2, 0, 0], ...SPIDER_BODY,
  });
  b.addPart(cyl(0.068, 0.074, 0.28, 8), 'hullSecondary', {
    name: 'torch acid nozzle barrel', position: [0, 0.64, 0.77], rotation: [Math.PI / 2, 0, 0], ...nozzleAnim,
  });
  b.addPart(cyl(0.050, 0.050, 0.05, 8), 'terraformEmerald', {
    name: 'mouth acid nozzle light', position: [0, 0.64, 0.92], rotation: [Math.PI / 2, 0, 0], emissiveIntensity: 4.5, ...nozzleAnim,
  });
  mirror((s) => {
    b.addPart(box(0.055, 0.08, 0.16), 'hullSecondary', {
      name: 'claw split jaw nozzle', position: [0.095 * s, 0.64, 0.89], rotation: [0, -0.18 * s, 0], ...nozzleAnim,
    });
  });
}

register({
  id: 'fauna.greenSpitter',
  label: 'Green Acid Spitter',
  category: 'fauna',
  footprint: [1, 1],
  zones: FAUNA_SPECIES_ZONES.greenSpitter,
  notes:
    'Emerald ranged acid insect: elevated pitched abdomen with luminous acid sacs, 6 grounded legs (animType 6/16), recoiling split-jaw acid nozzle (animType 39).',
  build: (b) => {
    b.addGreeble('bugSixLegs', {
      hx: 0.26, hy: 0.60, zPairs: [0.32, 0.02, -0.24],
      footSpreadX: 0.10, footSpreadZ: 1.54,
      rHip: 0.088, rFemur: 0.030, rKnee: 0.066, rTibia: 0.022, rFoot: 0.070,
    });
    addGreenSpitterThoraxAndAbdomen(b);
    addGreenSpitterHeadAndNozzle(b);
  },
});
