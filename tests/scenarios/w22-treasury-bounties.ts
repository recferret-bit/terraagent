import {
  creditResource,
  DEV_PLANET_RADIUS,
  ensureColonyLedger,
  hexDistance,
  indexOf,
  PREP,
  revealVision,
  setTilePrep,
  spawnHiveSite,
  startBuildingConstruction,
  TERRAIN,
  type PlanetState,
} from '@terra/sim';
import { defineScenario } from './_define';

const HIVE_Q = 18;
const HIVE_R = 0;

/**
 * W22 Treasury & Bounties (`docs/plan/waves/W22-treasury-bounties.md`).
 * Two live colonies, a Command Hub whose claim is colony 0's territory, and one living spotted
 * black-ant hive. Chain fee balance and cargo are not sim blobs: `W22ScenarioSeedService` writes
 * them when the server loads this scenario.
 */
export default defineScenario({
  id: 'w22',
  title: 'W22 Treasury & Bounties',
  waves: '..22',
  seed: 'w22-treasury-bounties',
  planet: { type: 'temperate', planetType: 'temperate', radius: DEV_PLANET_RADIUS },
  build(_host, api) {
    const state = api.planet;
    state.colonies[0] = colony(0, 'Treasury Spire');
    state.colonies[1] = colony(1, 'Bounty Reach');
    flattenDisc(state, 8);
    const hub = startBuildingConstruction(state, {
      owner: 0,
      building: 'commandHub',
      q: 0,
      r: 0,
      instant: true,
      costOverride: {},
      tick: 0,
    });
    if (!hub.ok) throw new Error(`w22 hub was not built: ${hub.code}`);
    spawnHiveSite(state, {
      species: 'blackAnt',
      q: HIVE_Q,
      r: HIVE_R,
      entranceQ: HIVE_Q - 2,
      entranceR: HIVE_R,
      initialResidents: 2,
    }, 0);
    revealVision(state, 0, HIVE_Q, HIVE_R, 4, 0);
    revealVision(state, 0, 0, 0, 8, 0);
    creditResource(state.colonies[0]!, 'metals.t1', 1000, 0);
    creditResource(state.colonies[1]!, 'metals.t1', 1000, 0);
    api.command('dev.skipnight', {});
  },
});

function colony(index: number, name: string) {
  return ensureColonyLedger({
    index,
    id: `col_${index}`,
    name,
    color: index === 0 ? 0xff6b00 : 0x3d7ea6,
    status: 'active',
    stage: 3,
    unlockStage: 3,
    threatStage: 1,
    changedAt: 0,
  });
}

function flattenDisc(state: PlanetState, radius: number): void {
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
