import { defineTable } from './_define';

/**
 * W13 recurring resource sinks (ECONOMY §2, §3): a repeatable multi-resource prestige project and the metered cargo
 * transport recipe. Calibration hypotheses (LED-18), not facts; a database profile overrides them (W13-38).
 *  - `project.<id>`: a project the player selects at the Command Hub. It runs as a `project` task in the Hub's Units
 *    lane of the order queue (progressive payment, 50 % cancel refund), takes `buildS` seconds, and on completion adds
 *    one to the colony's `prestige` counter. It pays no cash and gives no multiplier; repeating it costs again.
 *    Inputs mix tiers on purpose (T1 basics plus one advanced input).
 *  - `transport.cargo`: what one cargo export or import costs (W10 service): `cost` per started block of
 *    `unitsPerBlock` units, reserved when the operation is accepted, kept when it settles, returned when it fails.
 */
export default defineTable({
  name: 'prestige',
  summary: 'W13 prestige project recipes (mixed tiers, repeatable, no cash) and the metered cargo transport recipe.',
  units: { buildS: 'seconds' },
  amounts: ['cost'],
  rows: [
    {
      id: 'project.survey_array',
      wave: 'W13',
      label: 'Orbital Survey Array',
      buildS: 120,
      cost: { 'metals.t1': 60, 'minerals.t1': 40, 'bio.water': 30, 'minerals.t2': 8 },
    },
    {
      id: 'project.monument',
      wave: 'W13',
      label: 'Colony Monument',
      buildS: 240,
      cost: { 'metals.t1': 90, 'minerals.t1': 60, 'bio.biomass': 40, 'metals.t3': 4 },
    },
    {
      id: 'transport.cargo',
      wave: 'W13',
      label: 'Cargo transport service',
      unitsPerBlock: 100,
      cost: { 'bio.biomass': 2 },
    },
  ],
});
