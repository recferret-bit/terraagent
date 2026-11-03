import { DEV_PLANET_RADIUS } from '@terra/sim';
import { defineScenario } from './_define';

/**
 * W06 Invisible Chain: a guest colony in the W01 landfall state (pod descending at slot 0).
 * There is no stage engine here; this founded colony is the S1 the demo starts from.
 */
export const w06InvisibleChainScenario = defineScenario({
  id: 'w06',
  title: 'W06 Invisible Chain',
  waves: '..06',
  seed: 'w06-invisible-chain',
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

export default w06InvisibleChainScenario;
