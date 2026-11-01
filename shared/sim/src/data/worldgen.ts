import { defineTable } from './_define';

/**
 * World generation profiles (D-38), one row per planet type. The orchestrator (`gen/world/`) runs the listed stages
 * in order; the numbers shape relief (metres), the starter landing zone and the hidden subsurface. Heights are metres
 * above the build plane (tile centres are 2 m apart). Changing any number here changes generated planets: bump
 * `GEN_VERSION` (`gen/generators.ts`) in the same commit.
 */
export default defineTable({
  name: 'worldgen',
  summary: 'World generation profiles per planet type: stage list, relief, landing zone, hidden subsurface (D-38).',
  rows: [
    {
      id: 'desert',
      wave: 'W01',
      stages: ['reliefDesert', 'classifyDesert', 'deposits', 'subsurface', 'landing'],
      // Relief: dune seas (erg) vs gravel plains (reg), mountain ranges, mesas / buttes.
      ergScale: 0.006, duneHeightM: 4.5, duneWavelengthM: 16, duneCrossScale: 0.018,
      rangeScale: 0.004, rangeThreshold: 0.9, rangeHeightM: 13,
      mesaChancePerSector: 0.07, mesaRadiusMin: 3, mesaRadiusMax: 7, mesaHeightMinM: 4.5, mesaHeightMaxM: 9,
      // Classification: gradient (m per neighbour) above which sand is a dune face / scree (`slope`).
      slopeGradientM: 0.8, rockHeightM: 2.4, holeThreshold: 0.2,
      landingRadius: 7, landingFalloff: 5, clearLandingZone: true,
      subRock: 0.32, subSlope: 0.1, subForest: 0.12, subFlat: 0.03, subRichnessBoostBp: 12500,
    },
    {
      id: 'temperate',
      wave: 'W01',
      stages: ['temperateTerrain', 'deposits', 'subsurface', 'landing'],
      landingRadius: 4, landingFalloff: 3,
      subRock: 0.3, subSlope: 0.08, subForest: 0.12, subFlat: 0.02, subRichnessBoostBp: 12500,
    },
    {
      id: 'ocean',
      wave: 'W01',
      stages: ['temperateTerrain', 'deposits', 'subsurface', 'landing'],
      // Water-rich mix (shares in bp; the temperate classifier with these targets).
      shareFlat: 3300, shareForest: 2300, shareRock: 600, shareSlope: 800, shareHole: 200, shareShallow: 1300, shareDeep: 1500,
      landingRadius: 4, landingFalloff: 3,
      subRock: 0.3, subSlope: 0.08, subForest: 0.1, subFlat: 0.04, subRichnessBoostBp: 12500,
    },
  ],
});
