import { DEV_PLANET_RADIUS, ensureColonyLedger } from '@terra/sim';
import { defineScenario } from './_define';

/**
 * W09 offline: a flat dev planet and one colony so `away` / `back` have a seat.
 * The sim id is a fixture (`col_w09`). A joined dev session also gets a `co_` home id (BE-45);
 * the dev `away` command addresses that home id so the welcome digest matches.
 */
export default defineScenario({
  id: 'w09',
  title: 'W09 offline',
  waves: '..09',
  seed: 'w09-offline',
  planet: { type: 'flat', planetType: 'temperate', radius: DEV_PLANET_RADIUS },
  build(_host, api) {
    api.planet.colonies[0] = ensureColonyLedger({
      index: 0,
      id: 'col_w09',
      name: 'Away',
      color: 0xff6b00,
      status: 'active',
      changedAt: 0,
    });
  },
});
