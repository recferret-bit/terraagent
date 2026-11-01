import { defineTable } from './_define';

/**
 * Terrain classes and ground passability multipliers (§4.8 table), read by the running sim through compiled data
 * (`grid/tileModel.ts`). `code` mirrors the `TERRAIN` layer code (fixed). Generation numbers (class shares, deposit
 * richness, spawn slot guarantees) live in `data/worldgen.ts` (WE-19).
 */
export default defineTable({
  name: 'terrain',
  summary: 'Terrain classes and ground passability multipliers (W01).',
  fixed: { fields: ['code'], why: 'the code is the TERRAIN layer value stored in every planet' },
  rows: [
    { id: 'flat', wave: 'W01', code: 0, moveMult: 1.0, passable: true },
    { id: 'forest', wave: 'W01', code: 1, moveMult: 0.6, passable: true },
    { id: 'rock', wave: 'W01', code: 2, moveMult: 0.5, passable: true },
    { id: 'slope', wave: 'W01', code: 3, moveMult: 0.7, passable: true },
    { id: 'hole', wave: 'W01', code: 4, moveMult: 0.5, passable: true },
    { id: 'shallow', wave: 'W01', code: 5, moveMult: 0.5, passable: true },
    { id: 'deep', wave: 'W01', code: 6, moveMult: 0.0, passable: false },
    { id: 'temperate', wave: 'W01', livingMoveMult: 1.1 }, // UO-TF-07: Living tiles give +10 % move speed (every planet type)
  ],
});
