import { buildAvianCore } from '../../greebles/organic/vertebrates';
import { register } from './common';
import { AVIAN_FAUNA_ENTRIES } from './avianFaunaSpecs';

for (const entry of AVIAN_FAUNA_ENTRIES) {
  register({
    id: entry.id,
    label: entry.label,
    category: 'fauna',
    biosphere: true,
    footprint: [1, 1],
    snap: false,
    zones: entry.zones,
    notes: entry.notes,
    build: (b) => buildAvianCore(b, entry.spec),
  });
}
