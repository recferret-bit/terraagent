import { DEV_PLANET_RADIUS } from '@terra/sim';
import { defineScenario } from './_define';

/**
 * W28 Staking Overhaul, 4-Tier Orbital Patronage & Wealth Dashboard (`docs/plan/waves/W28-staking-overhaul.md`).
 * One landed colony (`Patron Spire`) at Stage 4 on a public temperate planet. Staking is wallet-level and never sim
 * state (D-31): the pilot wallet's mock NEAR / USDC, the 500 NEAR rival patron and the demo trades are written by
 * `W28ScenarioSeedService` when the server loads this scenario.
 */
export const w28StakingOverhaulScenario = defineScenario({
  id: 'w28',
  title: 'W28 Staking Overhaul & Orbital Patronage',
  waves: '..28',
  seed: 'w28-staking-overhaul',
  planet: { type: 'temperate', planetType: 'temperate', radius: DEV_PLANET_RADIUS },
  build(_host, api) {
    api.command('system.spawnColony', { colonyId: 'col_0', colonyIndex: 0, name: 'Patron Spire', slotIndex: 0 });
    api.command('dev.land', {}, 0);
    const col = api.planet.colonies[0];
    if (col) {
      col.status = 'active';
      col.stage = 4;
      col.unlockStage = 4;
    }
  },
});

export default w28StakingOverhaulScenario;
