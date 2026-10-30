import {
  creditResource,
  DEPOSIT,
  ensureColonyLedger,
  ENTITY_KIND,
  ENTITY_STATE,
  indexOf,
  insertRow,
  PREP,
  revealVision,
  setTilePrep,
  startBuildingConstruction,
  TERRAIN,
} from '@terra/sim';
import { defineScenario } from './_define';

/**
 * W02 First Light seed scenario (`docs/plan/waves/W02-first-light.md` §1 & W02-34):
 * - Command Hub T1 completed at `(0, 0)` (prepared 3×3 footprint, territory radius 6, `+8 supply / −5 demand`).
 * - HQ T1 worker ready at `(2, 0)` (`workRate = 1.5×`).
 * - Starting stock: `metals.t1 400, minerals.t1 250, bio.biomass 150, bio.water 150` (caps `500/500/500`).
 * - Nearby surface deposits (`DEPOSIT.metals` at `(3, 0)` and `(6, 0)`, `DEPOSIT.minerals` at `(0, 3)`).
 * - Morning (`06:00`, `daylight = 1.0`, `phase = 'day'`).
 */
export default defineScenario({
  id: 'w02',
  title: 'W02 First Light',
  waves: '..02',
  seed: 'w02-first-light',
  planet: { type: 'temperate', planetType: 'temperate', radius: 16 },
  build(_host, api) {
    const state = api.planet;
    const colony = ensureColonyLedger({
      index: 0,
      id: 'col-0',
      name: 'First Light',
      color: 0xff6b00,
      status: 'active',
      changedAt: 0,
    });
    state.colonies[0] = colony;

    // Clear and flatten the starting basin around (0, 0) (radius 8) so placement and pathing are unobstructed
    for (let r = -8; r <= 8; r++) {
      for (let q = -8; q <= 8; q++) {
        const idx = indexOf(state.grid.radius, q, r);
        if (idx >= 0) {
          state.grid.layers.terrain[idx] = TERRAIN.flat;
          state.grid.layers.deposit[idx] = DEPOSIT.none;
          state.grid.layers.richness[idx] = 0;
          setTilePrep(state, idx, PREP.wild, 0);
        }
      }
    }

    // Seed deterministic nearby deposits (1.0x richness = 10000 bp)
    const deposits: Array<[number, number, number]> = [
      [3, 0, DEPOSIT.metals],
      [3, 1, DEPOSIT.metals],
      [6, 0, DEPOSIT.metals],
      [0, 3, DEPOSIT.minerals],
      [1, 3, DEPOSIT.minerals],
      [-3, 0, DEPOSIT.oil],
    ];
    for (const [q, r, dep] of deposits) {
      const idx = indexOf(state.grid.radius, q, r);
      if (idx >= 0) {
        state.grid.layers.deposit[idx] = dep;
        state.grid.layers.richness[idx] = 10000;
      }
    }

    // Complete Command Hub T1 at (0, 0) for free before crediting starting stock
    startBuildingConstruction(state, {
      owner: 0,
      building: 'commandHub',
      q: 0,
      r: 0,
      instant: true,
      costOverride: {},
      tick: 0,
    });

    // Spawn HQ T1 worker at (2, -1)
    const hqId = state.meta.nextEntityId++;
    const hqRow = insertRow(state.entities, hqId, 0);
    state.entities.cols.kind[hqRow] = ENTITY_KIND.hq;
    state.entities.cols.owner[hqRow] = 0;
    state.entities.cols.tier[hqRow] = 1;
    state.entities.cols.q[hqRow] = 2;
    state.entities.cols.r[hqRow] = -1;
    state.entities.cols.x[hqRow] = 2;
    state.entities.cols.y[hqRow] = -1;
    state.entities.cols.hp[hqRow] = 800;
    state.entities.cols.hpMax[hqRow] = 800;
    state.entities.cols.cell[hqRow] = 200;
    state.entities.cols.cellMax[hqRow] = 200;
    state.entities.cols.workRate[hqRow] = 1.5;
    state.entities.cols.state[hqRow] = ENTITY_STATE.idle;
    revealVision(state, 0, 0, 0, 10, 0);

    // Seed starting stock: metals.t1 400, minerals.t1 250, bio.biomass 150, bio.water 150
    creditResource(colony, 'metals.t1', 400, 0);
    creditResource(colony, 'minerals.t1', 250, 0);
    creditResource(colony, 'bio.biomass', 150, 0);
    creditResource(colony, 'bio.water', 150, 0);

    // Ensure morning (06:00, daylight = 1.0) and evaluate initial power (+8 supply / -5 demand)
    api.command('dev.skipnight', {});
  },
});
