import { defineTable } from './_define';

/**
 * Basic S0 terraform operations: Grade, Clear, Break (`UO-TF` §4.5 table).
 * `timeS` converts to ticks in `compileData` (readers convert back to seconds for UI prep bills). `fromTerrain` /
 * `toTerrain` / `toPrep` are the tile rule the sim applies (terrain / prep keys of `grid/layers`).
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
