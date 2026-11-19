import { buildMammalCore } from '../../greebles/organic/vertebrates';
import { organ } from '../../greebles/organic/shapes';
import type { KitbashBuilder, PartOptions } from '../../KitbashRegistry';
import type { V3 } from '../../greebles/unitParts';
import { register } from './common';
import { WARM_FAUNA_ENTRIES } from './warmFaunaSpecs';
import type { WarmFurRuffKind } from './warmFaunaTypes';

function addFurRuffDetail(
  b: KitbashBuilder,
  kind: WarmFurRuffKind,
  neckPivot: V3,
  headCenter: V3,
  headAnim: PartOptions,
): void {
  const bodyOpts: PartOptions = { vertRig: { role: 1 } };
  if (kind === 'wolfCape') {
    b.addPart(organ([0.070, 0.036, 0.105], 6, 4.7, 0.014, 5), 'hullPrimary', {
      name: 'wolf dorsal cape ruff',
      position: [0, neckPivot[1] + 0.068, neckPivot[2] + 0.012],
      rotation: [-0.30, 0, 0],
      ...headAnim,
    });
    b.addPart(organ([0.066, 0.040, 0.088], 6, 3.3, 0.014, 5), 'hullPrimary', {
      name: 'wolf ventral neck ruff',
      position: [0, neckPivot[1] + 0.004, neckPivot[2] + 0.022],
      rotation: [0.46, 0, 0],
      ...headAnim,
    });
    return;
  }
  if (kind === 'stagMane') {
    b.addPart(organ([0.070, 0.044, 0.092], 6, 3.1, 0.012, 4), 'hullPrimary', {
      name: 'stag brisket mane fringe',
      position: [0, neckPivot[1] + 0.018, neckPivot[2] + 0.015],
      rotation: [0.85, 0, 0],
      ...headAnim,
    });
    b.addPart(organ([0.064, 0.038, 0.082], 6, 5.2, 0.010, 4), 'hullPrimary', {
      name: 'stag throat beard',
      position: [0, neckPivot[1] + 0.155, neckPivot[2] + 0.055],
      rotation: [1.08, 0, 0],
      ...headAnim,
    });
    return;
  }
  if (kind === 'oryxRidge') {
    b.addPart(organ([0.022, 0.040, 0.120], 6, 2.7, 0.012, 8), 'rubberDark', {
      name: 'dorsal neck mane ridge',
      position: [0, neckPivot[1] + 0.145, neckPivot[2] + 0.11],
      rotation: [-0.45, 0, 0],
      ...headAnim,
    });
    return;
  }
  if (kind === 'camelHumpTuft') {
    b.addPart(organ([0.115, 0.068, 0.145], 6, 6.1, 0.022, 8), 'hullSecondary', {
      name: 'dorsal hump wool crown',
      position: [0, 1.135, -0.05],
      rotation: [-0.08, 0, 0],
      ...bodyOpts,
    });
    return;
  }
  if (kind === 'lynxCheek') {
    for (const side of [-1, 1] as const) {
      b.addPart(organ([0.022, 0.030, 0.040], 6, 4.1 + side, 0.010, 7), 'hullPrimary', {
        name: `${side > 0 ? 'right' : 'left'} lynx cheek ruff`,
        position: [headCenter[0] + side * 0.072, headCenter[1] - 0.022, headCenter[2] - 0.015],
        rotation: [0.20, side * 0.38, -side * 0.28],
        ...headAnim,
      });
    }
  }
}

for (const entry of WARM_FAUNA_ENTRIES) {
  register({
    id: entry.id,
    label: entry.label,
    category: 'fauna',
    biosphere: true,
    footprint: [1, 1],
    zones: entry.zones,
    notes: entry.notes,
    build: (b) => {
      const { neckPivot, headCenter, headAnim } = buildMammalCore(b, entry.spec);
      if (entry.furRuff) {
        addFurRuffDetail(b, entry.furRuff, neckPivot, headCenter, headAnim);
      }
      if (entry.antlers) {
        b.addGreeble('cervineAntlers', {
          neckPivot,
          ...entry.antlers,
        });
      }
      if (entry.horns) {
        b.addGreeble('sweptHorns', {
          neckPivot,
          ...entry.horns,
        });
      }
    },
  });
}
