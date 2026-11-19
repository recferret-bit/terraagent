import { buildMammalCore } from '../../greebles/organic/vertebrates';
import { organ } from '../../greebles/organic/shapes';
import { register } from './common';
import { WARM_FAUNA_ENTRIES } from './warmFaunaSpecs';

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
      const { neckPivot, headAnim } = buildMammalCore(b, entry.spec);
      if (entry.maneNeck) {
        b.addPart(organ([0.056, 0.028, 0.075], 6, 4.7, 0.015, 8), 'hullSecondary', {
          name: 'cervical dorsal crest ruff',
          position: [0, entry.spec.neckPivot[1] + 0.145, entry.spec.neckPivot[2] + 0.135],
          rotation: [-0.35, 0, 0],
          ...headAnim,
        });
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
