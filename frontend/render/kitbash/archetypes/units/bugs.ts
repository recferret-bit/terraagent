import { FAUNA_SPECIES_ZONES } from '../../faunaVisualRegistry';
import type { KitbashBuilder, PartOptions } from '../../KitbashRegistry';
import { organ, tendril } from '../../greebles/organic/shapes';
import '../../greebles/organic/legs';
import type { V3 } from '../../greebles/unitParts';
import { register } from './common';

const body = { animType: 9 as const };
function shell(b: KitbashBuilder, name: string, size: V3, position: V3, options: PartOptions = {}): void {
  b.addPart(organ(size, 1, position[2], 0.018), 'hullPrimary', { name, position, ...body, ...options });
}
function eyes(b: KitbashBuilder, x: number, y: number, z: number, radius: number): void {
  for (const s of [-1, 1]) {
    b.addPart(organ([radius, radius * 0.75, radius * 1.3], 5, 0, 0, 8), 'glassVisor', {
      name: `${s} compound eye`, position: [s * x, y, z], ...body,
    });
  }
}
function feelers(b: KitbashBuilder, x: number, y: number, z: number, reach: number): void {
  for (const s of [-1, 1]) {
    const root: V3 = [x * s, y, z];
    b.addPart(tendril([root, [(x + 0.10) * s, y + 0.19, z + reach * 0.45],
      [(x + 0.21) * s, y + 0.14, z + reach]], [0.025, 0.018, 0.006], 1, 7, 5), 'hullSecondary', {
      name: `${s} probing antenna`, role: 'whip', animType: 59, animPivot: root,
    });
  }
}
function jaws(b: KitbashBuilder, y: number, z: number, width: number): void {
  for (const s of [-1, 1]) {
    const root: V3 = [width * s, y, z];
    b.addPart(tendril([root, [(width + 0.055) * s, y - 0.035, z + 0.15],
      [0.065 * s, y - 0.01, z + 0.28]], [0.075, 0.055, 0.008], 1, 6, 6), 'hullSecondary', {
      name: `${s} cutting mandible`, animType: 49, animPivot: root,
    });
  }
}
function ant(b: KitbashBuilder): void {
  b.addGreeble('organicSixLegs', { hx: 0.25, hy: 0.60, z: [0.28, 0, -0.28], thickness: 0.035 });
  shell(b, 'thorax mesosoma', [0.27, 0.20, 0.47], [0, 0.64, 0]);
  shell(b, 'petiole waist', [0.105, 0.12, 0.21], [0, 0.66, -0.48]);
  shell(b, 'pear shaped gaster', [0.33, 0.26, 0.48], [0, 0.70, -0.99]);
  shell(b, 'neck', [0.13, 0.13, 0.19], [0, 0.66, 0.43]);
  shell(b, 'head capsule', [0.28, 0.22, 0.29], [0, 0.67, 0.67]);
  eyes(b, 0.25, 0.72, 0.69, 0.065);
  feelers(b, 0.13, 0.81, 0.82, 0.48);
  jaws(b, 0.61, 0.87, 0.14);
}
function beetle(b: KitbashBuilder): void {
  b.addGreeble('organicSixLegs', { hx: 0.51, hy: 0.56, z: [0.34, 0, -0.34], thickness: 0.055 });
  b.addPart(organ([0.53, 0.10, 0.70], 2), 'frameGunmetal', { name: 'ventral abdomen', position: [0, 0.49, -0.16], ...body });
  shell(b, 'domed elytra', [0.53, 0.28, 0.70], [0, 0.81, -0.24]);
  b.addPart(tendril([[0, 0.991, 0.30], [0, 1.076, 0], [0, 1.096, -0.24], [0, 1.066, -0.55], [0, 0.985, -0.80]], [0.016, 0.016, 0.014], 2, 9, 5), 'frameGunmetal', { name: 'elytral suture', ...body });
  shell(b, 'pronotum', [0.48, 0.27, 0.31], [0, 0.71, 0.47]);
  shell(b, 'head', [0.28, 0.19, 0.25], [0, 0.64, 0.80]);
  eyes(b, 0.25, 0.70, 0.82, 0.060);
  b.addPart(tendril([[0, 0.66, 0.92], [0, 0.69, 1.17], [0, 0.98, 1.30], [0, 1.10, 1.27]],
    [0.14, 0.10, 0.055, 0.008], 1, 9, 7), 'hullSecondary', { name: 'curved cephalic horn', ...body });
  feelers(b, 0.20, 0.64, 0.90, 0.27);
}
function spitter(b: KitbashBuilder): void {
  b.addGreeble('organicSixLegs', { hx: 0.26, hy: 0.60, z: [0.28, 0, -0.28], thickness: 0.036 });
  shell(b, 'thorax', [0.28, 0.22, 0.45], [0, 0.65, 0.02]);
  shell(b, 'abdomen stalk', [0.18, 0.18, 0.27], [0, 0.77, -0.42]);
  shell(b, 'arched abdomen', [0.36, 0.33, 0.48], [0, 0.99, -0.80], { rotation: [0.35, 0, 0] });
  for (const s of [-1, 1]) {
    b.addPart(organ([0.18, 0.24, 0.32], 3, s, 0.03), 'hullSecondary', {
      name: `${s} secretory sac`, position: [s * 0.28, 1.00, -0.84], animType: 69, animPivot: [s * 0.18, 0.95, -0.77],
    });
  }
  shell(b, 'head capsule', [0.26, 0.20, 0.27], [0, 0.67, 0.55]);
  eyes(b, 0.23, 0.72, 0.58, 0.052);
  jaws(b, 0.61, 0.72, 0.12);
  b.addPart(organ([0.095, 0.085, 0.10], 3, 1, 0, 8), 'hullSecondary', {
    name: 'oral acid gland', position: [0, 0.64, 0.78], ...body,
  });
  feelers(b, 0.13, 0.80, 0.69, 0.31);
}

for (const [species, label, build, footprint] of [
  ['blackAnt', 'Black Ant', ant, [1, 1]],
  ['blueBeetle', 'Armored Blue Beetle', beetle, [2, 2]],
  ['greenSpitter', 'Green Acid Spitter', spitter, [1, 1]],
] as const) register({
  id: `fauna.${species}`, label, category: 'fauna', footprint: [...footprint],
  zones: FAUNA_SPECIES_ZONES[species], build,
  notes: 'Organic chitin, articulated hooked legs, glossy compound eyes and anatomical growth textures. GPU jaws, antennae and bounded secretory-tissue motion.',
});
