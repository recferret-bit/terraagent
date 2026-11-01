import { defineTable } from './_define';

/**
 * Basic S0 terraform operations: Grade, Clear, Break (`UO-TF` §4.5 table).
 * `timeS` converts to ticks in `compileData`; `designSeconds` stays in seconds for UI prep bills.
 */
export default defineTable({
  name: 'opsBasic',
  summary: 'S0 ground preparation operations Grade, Clear, and Break (UO-TF §4.5).',
  units: { timeS: 'seconds' },
  amounts: ['yieldAmount'],
  rows: [
    {
      id: 'grade',
      wave: 'W01',
      timeS: 3,
      baseTimeS: 3,
      designSeconds: 3,
      energy: 20,
      energyCostE: 20,
      fromTerrain: 'flat',
      toTerrain: 'flat',
      toPrep: 'prepared',
      yieldResource: null,
      yieldAmount: 0,
      unlockStage: 0,
    },
    {
      id: 'clear',
      wave: 'W01',
      timeS: 5,
      baseTimeS: 5,
      designSeconds: 5,
      energy: 30,
      energyCostE: 30,
      fromTerrain: 'forest',
      toTerrain: 'flat',
      toPrep: 'flat',
      yieldResource: 'bio.biomass',
      yieldAmount: 5,
      unlockStage: 0,
    },
    {
      id: 'break',
      wave: 'W01',
      timeS: 6,
      baseTimeS: 6,
      designSeconds: 6,
      energy: 60,
      energyCostE: 60,
      fromTerrain: 'rock',
      toTerrain: 'flat',
      toPrep: 'flat',
      yieldResource: 'metals.t1',
      yieldAmount: 10,
      unlockStage: 0,
    },
  ],
});
