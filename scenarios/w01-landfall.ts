import { DEV_PLANET_RADIUS } from '@terra/sim';
import { defineScenario } from './_define';

/**
 * W01 Landfall: temperate hex planet at the drop moment (pod descending at slot 0, cargo 600/350/200/200).
 */
export const w01LandfallScenario = defineScenario({
  id: 'w01',
  title: 'W01 Landfall',
  waves: '..01',
  seed: 'w01-landfall',
  planet: { type: 'temperate', planetType: 'temperate', radius: DEV_PLANET_RADIUS },
  build(_host, api) {
    api.command('system.spawnColony', {
      colonyId: 'col_0',
      colonyIndex: 0,
      name: "Colonist's Colony",
      slotIndex: 0,
    });
  },
});

export default w01LandfallScenario;
