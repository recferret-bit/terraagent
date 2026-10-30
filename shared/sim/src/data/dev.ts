import { defineTable } from './_define';

/**
 * W00 dev table: the probe row proves unit conversion and the `tune` balance override loop end to end
 * (a 30 s build → 150 ticks; 2.5 /s → 0.5 per tick). The dev `nudge` command reads `nudgeTiles`.
 */
export default defineTable({
  name: 'dev',
  summary: 'Platform test row (no gameplay meaning).',
  units: { buildS: 'seconds', ratePerS: 'perSecond' },
  rows: [{ id: 'probe', wave: 'W00', buildS: 30, ratePerS: 2.5, nudgeTiles: 1 }],
});
