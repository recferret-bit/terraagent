import { defineTable } from './_define';

/**
 * W13 regional endowment defaults (ECONOMY §2.2, W13-50). These rows are the bootstrap GLOBAL layer of the resolution order
 * global -> planetType -> planetId -> sectorArchetype -> sectorId, plus illustrative planet-type presets. They are
 * **calibration fixtures awaiting simulation, not live economics**: production pins a database profile version.
 *  - `defaults` carries one value per field for ALL ten ResourceKeys (maps) and the sector deposit density.
 *    Endowment fields (weights, reserves, find weights, starter guarantee, density) are new-world only; yields and renewal are runtime.
 *  - `preset.<planetType>` rows are the §2.2 abundance table in bp (100 abundance points = 100 bp, reference weight 10000 bp).
 *    Only the five sample columns are listed; unlisted resources inherit the global default.
 * Reserves/starter values are whole units; weights and yields are bp.
 */
const ten = (v: Record<string, number>) => v;

export default defineTable({
  name: 'regions',
  summary: 'W13 regional endowment bootstrap: global per-resource weights/reserves/yields/renewal/starter guarantees and planet-type presets (fixtures).',
  amounts: ['reserveUnitsMin', 'reserveUnitsMax', 'starterGuarantee', 'renewableUnitsPerSimHour'],
  rows: [
    {
      id: 'defaults',
      wave: 'W13',
      depositDensityPer1000Tiles: 40,
      occurrenceWeightBp: ten({
        'metals.t1': 10000, 'metals.t2': 4000, 'metals.t3': 1500, 'minerals.t1': 10000, 'minerals.t2': 4000, 'minerals.t3': 1500,
        'bio.water': 10000, 'bio.biomass': 10000, 'bio.t2': 4000, 'bio.t3': 1500,
      }),
      reserveUnitsMin: ten({
        'metals.t1': 200, 'metals.t2': 100, 'metals.t3': 50, 'minerals.t1': 200, 'minerals.t2': 100, 'minerals.t3': 50,
        'bio.water': 200, 'bio.biomass': 200, 'bio.t2': 100, 'bio.t3': 50,
      }),
      reserveUnitsMax: ten({
        'metals.t1': 1000, 'metals.t2': 500, 'metals.t3': 200, 'minerals.t1': 1000, 'minerals.t2': 500, 'minerals.t3': 200,
        'bio.water': 1000, 'bio.biomass': 1000, 'bio.t2': 500, 'bio.t3': 200,
      }),
      terraformFindWeightBp: ten({
        'metals.t1': 10000, 'metals.t2': 3000, 'metals.t3': 1000, 'minerals.t1': 10000, 'minerals.t2': 3000, 'minerals.t3': 1000,
        'bio.water': 10000, 'bio.biomass': 10000, 'bio.t2': 3000, 'bio.t3': 1000,
      }),
      starterGuarantee: ten({
        'metals.t1': 300, 'metals.t2': 0, 'metals.t3': 0, 'minerals.t1': 300, 'minerals.t2': 0, 'minerals.t3': 0,
        'bio.water': 300, 'bio.biomass': 0, 'bio.t2': 0, 'bio.t3': 0,
      }),
      extractionYieldBp: ten({
        'metals.t1': 10000, 'metals.t2': 10000, 'metals.t3': 10000, 'minerals.t1': 10000, 'minerals.t2': 10000, 'minerals.t3': 10000,
        'bio.water': 10000, 'bio.biomass': 10000, 'bio.t2': 10000, 'bio.t3': 10000,
      }),
      renewableUnitsPerSimHour: ten({
        'metals.t1': 0, 'metals.t2': 0, 'metals.t3': 0, 'minerals.t1': 0, 'minerals.t2': 0, 'minerals.t3': 0,
        'bio.water': 0, 'bio.biomass': 0, 'bio.t2': 0, 'bio.t3': 0,
      }),
    },
    // §2.2 illustrative abundance weights (iron = metals.t1, silica = minerals.t1, crystal = minerals.t3), 100 points = 100 bp.
    { id: 'preset.desert', wave: 'W13', occurrenceWeightBp: ten({ 'metals.t1': 15000, 'minerals.t1': 16000, 'bio.water': 3000, 'bio.biomass': 2000, 'minerals.t3': 1500 }) },
    { id: 'preset.ocean', wave: 'W13', occurrenceWeightBp: ten({ 'metals.t1': 6000, 'minerals.t1': 8000, 'bio.water': 18000, 'bio.biomass': 15000, 'minerals.t3': 6000 }) },
    { id: 'preset.temperate', wave: 'W13', occurrenceWeightBp: ten({ 'metals.t1': 10000, 'minerals.t1': 12000, 'bio.water': 11000, 'bio.biomass': 10000, 'minerals.t3': 10000 }) },
  ],
});
