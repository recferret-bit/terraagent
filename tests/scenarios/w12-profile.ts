import { DEV_PLANET_RADIUS } from '@terra/sim';
import { defineScenario } from './_define';

/**
 * W12 Player Page & Achievements: a seeded pilot with 9 earned achievement tiers, Level 4 (`1 120 / 1 500` XP,
 * title `Surveyor`), `unlockStage = 4`, an active colony on a temperate planet, and 2 past colonies.
 */
export const w12ProfileScenario = defineScenario({
  id: 'w12',
  title: 'W12 Player Page & Achievements',
  waves: '..12',
  seed: 'w12-profile-achievements',
  planet: { type: 'temperate', planetType: 'temperate', radius: DEV_PLANET_RADIUS },
  build(_host, api) {
    api.command('system.spawnColony', {
      colonyId: 'col_0',
      colonyIndex: 0,
      name: 'Aegis Basin',
      slotIndex: 0,
    });
    api.command('dev.land', {}, 0);
  },
});

export default w12ProfileScenario;
