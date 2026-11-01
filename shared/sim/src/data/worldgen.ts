import { defineTable } from './_define';

/**
 * World generation profiles (D-38), one row per planet type, plus `shared`: the numbers every profile uses unless its
 * own row sets the field (`gen/profile.ts`). The orchestrator (`gen/world/`) runs the listed stages in order; the
 * numbers shape relief (metres), class shares, deposit richness, the spawn slot guarantees (UO-TF-09), the starter
 * landing zone and the hidden subsurface. Heights are metres above the build plane (tile centres are 2 m apart).
 *
 * Generation reads these rows from the file, once, when a planet is built; the table is `fixed` (WE-19): `tune` and
 * balance overrides reject it. Changing any number here changes generated planets: bump `GEN_VERSION`
 * (`gen/generators.ts`) in the same commit.
 */
export default defineTable({
  name: 'worldgen',
  summary: 'World generation profiles per planet type: stage list, relief, shares, richness, spawn slots, landing zone, hidden subsurface (D-38).',
  fixed: { fields: '*', why: 'world generation reads the file rows once when a planet is built; change data/worldgen.ts and bump GEN_VERSION' },
  rows: [
    {
      id: 'shared',
      wave: 'W01',
      // Spawn slots (UO-TF-09): ring of radius 32 (±3), r<=4 mostly Flat, metals with a free 2x2 within r<=8, every
      // deposit kind within r<=12.
      spawnRingRadius: 32, spawnRingJitter: 3, spawnGuaranteeRadius: 4, spawnMinFlatShareBp: 6000, spawnMaxNonFlatPer3x3: 3,
      spawnMetalsRadius: 8, spawnAllDepositsRadius: 12,
      // Deposit richness: base draw in [min, max] bp, times the profile's per-resource modifier (D-33).
      richnessMinBp: 9000, richnessMaxBp: 12000, metalsRichnessModBp: 10000, mineralsRichnessModBp: 10000, oilRichnessModBp: 10000,
    },
    {
      id: 'desert',
      wave: 'W01',
      stages: ['reliefDesert', 'classifyDesert', 'deposits', 'landing', 'subsurface'],
      // Relief: dune seas (erg) vs gravel plains (reg), mountain ranges, mesas / buttes.
      ergScale: 0.006, duneHeightM: 4.5, duneWavelengthM: 16, duneCrossScale: 0.018,
      rangeScale: 0.004, rangeThreshold: 0.9, rangeHeightM: 13,
      mesaChancePerSector: 0.07, mesaRadiusMin: 3, mesaRadiusMax: 7, mesaHeightMinM: 4.5, mesaHeightMaxM: 9,
      // Classification: gradient (m per neighbour) above which sand is a dune face / scree (`slope`).
      slopeGradientM: 0.8, rockHeightM: 2.4, holeThreshold: 0.2,
      metalsRichnessModBp: 11500, mineralsRichnessModBp: 11500, // desert Metals / Minerals +15 %
      landingRadius: 7, landingFalloff: 5, clearLandingZone: true,
      subRock: 0.32, subSlope: 0.1, subForest: 0.12, subFlat: 0.03, subRichnessBoostBp: 12500,
    },
    {
      id: 'temperate',
      wave: 'W01',
      stages: ['temperateTerrain', 'deposits', 'landing', 'subsurface'],
      // Class shares in bp (§4.5 mix; the quota classifier fills exactly these).
      shareFlat: 4500, shareForest: 2500, shareRock: 800, shareSlope: 1000, shareHole: 200, shareShallow: 600, shareDeep: 400,
      mineralsRichnessModBp: 11500, // D-33: Temperate Minerals +15 %
      landingRadius: 4, landingFalloff: 3,
      subRock: 0.3, subSlope: 0.08, subForest: 0.12, subFlat: 0.02, subRichnessBoostBp: 12500,
    },
    {
      id: 'ocean',
      wave: 'W01',
      stages: ['temperateTerrain', 'deposits', 'landing', 'subsurface'],
      // Water-rich mix (shares in bp; the temperate classifier with these targets).
      shareFlat: 3300, shareForest: 2300, shareRock: 600, shareSlope: 800, shareHole: 200, shareShallow: 1300, shareDeep: 1500,
      oilRichnessModBp: 12000, metalsRichnessModBp: 8500, // ocean Oil +20 %, Metals −15 %
      landingRadius: 4, landingFalloff: 3,
      subRock: 0.3, subSlope: 0.08, subForest: 0.1, subFlat: 0.04, subRichnessBoostBp: 12500,
    },
  ],
});
