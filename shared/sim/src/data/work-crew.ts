import { defineTable } from './_define';

/**
 * Builder work shared by building, repair and dismantle (owner feedback W03 #6, #9):
 * - `crew`: several workers on one job (a construction site, a repair, a dismantle). The k-th worker on the job in a
 *   step (k = 0 for the first) adds `helperEfficiency^k` of its own work rate; workers past `maxCrew` add nothing.
 *   Payment follows progress (`payProgressiveSlice`), so a crew finishes sooner at the same total cost. An idle Builder
 *   Drone within `autoHelpRadius` hexes joins an open repair or dismantle job by itself.
 * - `repair`: a repair costs `costRate` × the entity's build cost × the share of HP it restores, paid as it advances.
 * - `dismantle`: takes `timeFactor` × the building's build time (at the worker's work rate) and refunds `refundRate`
 *   of its build cost (the building row's `demolishRefundRatio` when set) step by step as it advances.
 * Tunable: `tune workCrew.crew.helperEfficiency 0.5`.
 */
export default defineTable({
  name: 'workCrew',
  summary: 'Crew scaling of several workers on one job, repair cost rate, dismantle time factor and refund rate (W02/W03).',
  rows: [
    { id: 'crew', wave: 'W02', helperEfficiency: 0.6, maxCrew: 4, autoHelpRadius: 12 },
    { id: 'repair', wave: 'W02', costRate: 0.4 },
    { id: 'dismantle', wave: 'W02', timeFactor: 0.5, refundRate: 0.5 },
  ],
});
