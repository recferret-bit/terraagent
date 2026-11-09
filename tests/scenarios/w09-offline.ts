import {
  creditResource,
  DEV_PLANET_RADIUS,
  ensureColonyLedger,
  ENTITY_KIND,
  ENTITY_STATE,
  insertRow,
  placeSpawnedEntity,
  revealVision,
  startBuildingConstruction,
  type PlanetState,
} from '@terra/sim';
import { defineScenario } from './_define';

/** A landed hub and HQ so `?scenario=w09` opens on the colony, not an empty night drop. */
function seedAwayColony(state: PlanetState): void {
  const colony = ensureColonyLedger({
    index: 0,
    id: 'col_w09',
    name: 'Away',
    color: 0xff6b00,
    status: 'active',
    changedAt: 0,
  });
  state.colonies[0] = colony;
  startBuildingConstruction(state, {
    owner: 0,
    building: 'commandHub',
    q: 0,
    r: 0,
    instant: true,
    costOverride: {},
    tick: 0,
  });
  const hqId = state.meta.nextEntityId++;
  const row = insertRow(state.entities, hqId, 0);
  const cols = state.entities.cols;
  cols.kind[row] = ENTITY_KIND.hq;
  cols.owner[row] = 0;
  cols.tier[row] = 1;
  cols.hp[row] = 800;
  cols.hpMax[row] = 800;
  cols.cell[row] = 200;
  cols.cellMax[row] = 200;
  cols.workRate[row] = 1.5;
  cols.state[row] = ENTITY_STATE.idle;
  placeSpawnedEntity(state.entities, row, 2, -1, 0);
  revealVision(state, 0, 0, 0, 10, 0);
  creditResource(colony, 'metals.t1', 400, 0);
  creditResource(colony, 'minerals.t1', 250, 0);
  creditResource(colony, 'bio.biomass', 150, 0);
  creditResource(colony, 'bio.water', 150, 0);
}

/**
 * W09 offline: a flat morning colony so `away` / `back` have a seat and the page shows the game.
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
    seedAwayColony(api.planet);
    api.command('dev.skipnight', {});
  },
});
