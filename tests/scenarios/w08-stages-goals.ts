import {
  creditResource,
  DEPOSIT,
  ensureColonyLedger,
  ENTITY_KIND,
  ENTITY_STATE,
  indexOf,
  insertRow,
  placeSpawnedEntity,
  PREP,
  revealVision,
  setTilePrep,
  TERRAIN,
} from '@terra/sim';
import { defineScenario } from './_define';

/**
 * W08 Stages & HQ Goals seed scenario (`docs/plan/waves/W08-stages-goals.md` §1 & W08-33):
 * - Fresh colony at `S0 Landfall` (`stage = 0`, `unlockStage = 0`, `threatStage = 0`).
 * - HQ T1 worker ready at `(2, -1)` (`workRate = 1.5×`, `goalLimit = 2`).
 * - Starter clearing around `(0, 0)` with one raw tile `(1, 0)` (`PREP.wild`) on the Hub footprint so `Establish Colony`
 *   breaks down into site-prep Grade on the clearing, `Command Hub` placement at `(0, 0)`, `Metals Extractor` on the
 *   nearest metals deposit `(4, -2)`, and `Solar Collector`.
 * - Starting stock: `metals.t1 500, minerals.t1 400, bio.biomass 200, bio.water 200` (caps `500/500/500`).
 * - Morning (`06:00`, `daylight = 1.0`, `phase = 'day'`).
 */
export const w08StagesGoalsScenario = defineScenario({
  id: 'w08',
  title: 'W08 Stages & HQ Goals',
  waves: '..08',
  seed: 'w08-stages-goals',
  planet: { type: 'temperate', planetType: 'temperate', radius: 16 },
  build(_host, api) {
    const state = api.planet;
    const colony = ensureColonyLedger({
      index: 0,
      id: 'col-0',
      name: 'First Light',
      color: 0xff6b00,
      status: 'active',
      stage: 0,
      unlockStage: 0,
      threatStage: 0,
      // The colony AI is off by default; this scenario exercises goals and autopilot, so it starts with the AI on.
      aiEnabled: true,
      changedAt: 0,
    });
    state.colonies[0] = colony;

    // Ensure all open ground and deposit tiles across the planet sit on level, terraformed flat ground
    for (let i = 0; i < state.grid.count; i++) {
      const t = state.grid.layers.terrain[i];
      if (
        t === TERRAIN.flat ||
        t === TERRAIN.slope ||
        t === TERRAIN.hole ||
        state.grid.layers.deposit[i] !== DEPOSIT.none
      ) {
        state.grid.layers.terrain[i] = TERRAIN.flat;
        state.grid.layers.height[i] = 0.08;
        setTilePrep(state, i, PREP.flat, 0);
      }
    }

    // Clear and flatten the starting basin around (0, 0) (radius 8) so placement and pathing are unobstructed
    for (let r = -8; r <= 8; r++) {
      for (let q = -8; q <= 8; q++) {
        const idx = indexOf(state.grid.radius, q, r);
        if (idx >= 0) {
          state.grid.layers.terrain[idx] = TERRAIN.flat;
          state.grid.layers.height[idx] = 0.08;
          state.grid.layers.deposit[idx] = DEPOSIT.none;
          state.grid.layers.richness[idx] = 0;
          setTilePrep(state, idx, PREP.flat, 0);
        }
      }
    }

    // Leave one tile on the starter clearing raw (`PREP.wild`) so `Establish Colony` starts with site-prep Grade
    const rawClearIdx = indexOf(state.grid.radius, 1, 0);
    if (rawClearIdx >= 0) {
      setTilePrep(state, rawClearIdx, PREP.wild, 0);
    }

    // Seed deterministic nearby deposits (1.0x richness = 10000 bp)
    const deposits: Array<[number, number, number]> = [
      [4, -2, DEPOSIT.metals],
      [4, -1, DEPOSIT.metals],
      [6, 0, DEPOSIT.metals],
      [0, 4, DEPOSIT.minerals],
      [1, 4, DEPOSIT.minerals],
      [-4, 0, DEPOSIT.oil],
    ];
    for (const [q, r, dep] of deposits) {
      const idx = indexOf(state.grid.radius, q, r);
      if (idx >= 0) {
        state.grid.layers.terrain[idx] = TERRAIN.flat;
        state.grid.layers.height[idx] = 0.08;
        state.grid.layers.deposit[idx] = dep;
        state.grid.layers.richness[idx] = 10000;
        setTilePrep(state, idx, PREP.flat, 0);
      }
    }

    // Spawn HQ T1 worker at (2, -1)
    const hqId = state.meta.nextEntityId++;
    const hqRow = insertRow(state.entities, hqId, 0);
    state.entities.cols.kind[hqRow] = ENTITY_KIND.hq;
    state.entities.cols.owner[hqRow] = 0;
    state.entities.cols.tier[hqRow] = 1;
    placeSpawnedEntity(state.entities, hqRow, 2, -1, 0);
    state.entities.cols.hp[hqRow] = 800;
    state.entities.cols.hpMax[hqRow] = 800;
    state.entities.cols.cell[hqRow] = 200;
    state.entities.cols.cellMax[hqRow] = 200;
    state.entities.cols.workRate[hqRow] = 1.5;
    state.entities.cols.state[hqRow] = ENTITY_STATE.idle;
    revealVision(state, 0, 0, 0, 10, 0);

    // Seed starting stock: metals.t1 500, minerals.t1 400, bio.biomass 200, bio.water 200
    creditResource(colony, 'metals.t1', 500, 0);
    creditResource(colony, 'minerals.t1', 400, 0);
    creditResource(colony, 'bio.biomass', 200, 0);
    creditResource(colony, 'bio.water', 200, 0);

    // Ensure morning (06:00, daylight = 1.0)
    api.command('dev.skipnight', {});
  },
});

export default w08StagesGoalsScenario;
