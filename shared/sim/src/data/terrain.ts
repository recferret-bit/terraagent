import { defineTable } from './_define';

/**
 * Terrain classes, Temperate generator targets (§4.5 mix, SIM-GEN), deposit richness modifiers (D-33),
 * and ground passability multipliers (§4.8 table).
 */
export default defineTable({
  name: 'terrain',
  summary: 'Terrain classes, passability multipliers, and Temperate planet generator rows (W01).',
  rows: [
    { id: 'flat', wave: 'W01', code: 0, moveMult: 1.0, passable: true, temperateShareBp: 4500 },
    { id: 'forest', wave: 'W01', code: 1, moveMult: 0.6, passable: true, temperateShareBp: 2500 },
    { id: 'rock', wave: 'W01', code: 2, moveMult: 0.5, passable: true, temperateShareBp: 800 },
    { id: 'slope', wave: 'W01', code: 3, moveMult: 0.7, passable: true, temperateShareBp: 1000 },
    { id: 'hole', wave: 'W01', code: 4, moveMult: 0.5, passable: true, temperateShareBp: 200 },
    { id: 'shallow', wave: 'W01', code: 5, moveMult: 0.5, passable: true, temperateShareBp: 600 },
    { id: 'deep', wave: 'W01', code: 6, moveMult: 0.0, passable: false, temperateShareBp: 400 },
    {
      id: 'temperate',
      wave: 'W01',
      radius: 56,
      spawnRingRadius: 32,
      spawnRingJitter: 3,
      spawnGuaranteeRadius: 4,
      spawnMinFlatShareBp: 6000,
      spawnMaxNonFlatPer3x3: 3,
      spawnMetalsRadius: 8,
      spawnAllDepositsRadius: 12,
      richnessMinBp: 9000,
      richnessMaxBp: 12000,
      metalsRichnessModBp: 10000,
      mineralsRichnessModBp: 11500, // D-33: Temperate Minerals +15 %
      oilRichnessModBp: 10000,
      livingMoveMult: 1.1, // UO-TF-07: Living tiles give +10 % move speed
    },
  ],
});
