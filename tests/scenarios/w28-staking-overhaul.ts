import {
  DEV_PLANET_RADIUS,
  ensureColonyLedger,
  hexDistance,
  indexOf,
  PREP,
  revealVision,
  setTilePrep,
  startBuildingConstruction,
  TERRAIN,
  type PlanetState,
} from '@terra/sim';
import { defineScenario } from './_define';

/**
 * W28 Staking Overhaul, 4-Tier Orbital Patronage & Wealth Dashboard (`docs/plan/waves/W28-staking-overhaul.md`).
 * One active colony (`Patron Spire`, Stage 4) with a finished Command Hub at the centre of a flat, owned disc, so the
 * cosmetic tier visuals (uplink beam + quantum dish at Tier 1+, gold trim at Tier 3+) have an HQ to dress. Staking is
 * wallet-level and never sim state (D-31): the pilot wallet's mock NEAR / USDC and the 500 NEAR rival patron are
 * written by `W28ScenarioSeedService` when the server loads this scenario.
 */
export const w28StakingOverhaulScenario = defineScenario({
  id: 'w28',
  title: 'W28 Staking Overhaul & Orbital Patronage',
  waves: '..28',
  seed: 'w28-staking-overhaul',
  planet: { type: 'temperate', planetType: 'temperate', radius: DEV_PLANET_RADIUS },
  build(_host, api) {
    const state = api.planet;
    state.colonies[0] = ensureColonyLedger({
      index: 0,
      id: 'col_0',
      name: 'Patron Spire',
      color: 0xff6b00,
      status: 'active',
      stage: 4,
      unlockStage: 4,
      threatStage: 1,
      changedAt: 0,
    });
    flattenOwnedDisc(state, 7);
    const hub = startBuildingConstruction(state, { owner: 0, building: 'commandHub', q: 0, r: 0, instant: true, costOverride: {}, tick: 0 });
    if (!hub.ok) throw new Error(`w28 hub was not built: ${hub.code}`);
    revealVision(state, 0, 0, 0, 9, 0);
    api.command('dev.skipnight', {});
  },
});

function flattenOwnedDisc(state: PlanetState, radius: number): void {
  for (let r = -radius; r <= radius; r++) {
    for (let q = -radius; q <= radius; q++) {
      if (hexDistance(0, 0, q, r) > radius) continue;
      const idx = indexOf(state.grid.radius, q, r);
      if (idx < 0) continue;
      state.grid.layers.terrain[idx] = TERRAIN.flat;
      state.grid.layers.height[idx] = 0.08;
      state.grid.layers.owner[idx] = 0;
      setTilePrep(state, idx, PREP.prepared, 0);
    }
  }
}

export default w28StakingOverhaulScenario;
