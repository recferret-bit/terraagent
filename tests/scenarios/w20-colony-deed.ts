import { DEV_PLANET_RADIUS } from '@terra/sim';
import { defineScenario } from './_define';

/**
 * W20 Colony Deed & Staking (`docs/plan/waves/W20-colony-deed.md`).
 * A landed colony (`Aegis Spire`) at Stage 4 (`unlockStage = 4`) with 40% Terraform progress
 * (`terraformBp = 4000`), an active v1 Colony Deed NFT (`deed:col_0`), and 100 mock NEAR in the
 * pilot wallet ready for staking once the Deed is Settled and the colony account is claimed.
 */
export const w20ColonyDeedScenario = defineScenario({
  id: 'w20',
  title: 'W20 Colony Deed & Staking',
  waves: '..20',
  seed: 'w20-colony-deed',
  planet: { type: 'temperate', planetType: 'temperate', radius: DEV_PLANET_RADIUS },
  build(_host, api) {
    api.command('system.spawnColony', {
      colonyId: 'col_0',
      colonyIndex: 0,
      name: 'Aegis Spire',
      slotIndex: 0,
    });
    api.command('dev.land', {}, 0);
    const col = api.planet.colonies[0];
    if (col) {
      col.status = 'active';
      col.stage = 4;
      col.unlockStage = 4;
    }
  },
});

export default w20ColonyDeedScenario;
