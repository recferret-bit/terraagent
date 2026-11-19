import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  BUILDING_KIND,
  canFaunaAttackPlayer,
  computeColonyPlanetDamage,
  createRegistryPipeline,
  createState,
  DEPOSIT,
  ensureColonyLedger,
  ensureColonyRecord,
  ENTITY_KIND,
  ENTITY_STATE,
  getActiveCohorts,
  hexIndex,
  ingestEcologicalDamageEvents,
  insertRow,
  isHiveAggressiveToColony,
  placeSpawnedEntity,
  PLANET_DAMAGE_AGGRESSION_THRESHOLD,
  PREP,
  SimHost,
  spawnHiveEntity,
  spawnHqUnit,
  TERRAIN,
} from '../../src';

function createPeacefulColonyHost(seed = 'peaceful-planet') {
  const flags = parseWaves('..08');
  const pipeline = createRegistryPipeline({ flags });
  const data = pipeline.config.data;
  const host = new SimHost(pipeline);
  const state = createState({ planetId: 'pl-eco', planetType: 'temperate', seed, radius: 24 });
  state.grid.layers.terrain.fill(TERRAIN.flat);
  state.grid.layers.prep.fill(PREP.flat);
  const col = ensureColonyLedger(ensureColonyRecord(state, 0, 0), { baseCap: 2000 });
  col.status = 'active';
  col.stage = 3;
  col.threatStage = 3;
  col.s3ReachedAtTick = 0;
  spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
  host.load(state);
  return { host, state, data, pipeline };
}

describe('Planetary ecological damage & insect-only player aggression', () => {
  it('enforces that only insect hive species can ever attack player colonies, never warm-blooded or avian wildlife', () => {
    expect(canFaunaAttackPlayer('blackAnt')).toBe(true);
    expect(canFaunaAttackPlayer('blueBeetle')).toBe(true);
    expect(canFaunaAttackPlayer('greenSpitter')).toBe(true);
    expect(canFaunaAttackPlayer(ENTITY_KIND.blackAnt)).toBe(true);
    expect(canFaunaAttackPlayer(ENTITY_KIND.blueBeetle)).toBe(true);
    expect(canFaunaAttackPlayer(ENTITY_KIND.greenSpitter)).toBe(true);

    expect(canFaunaAttackPlayer('timberWolf')).toBe(false);
    expect(canFaunaAttackPlayer('crownStag')).toBe(false);
    expect(canFaunaAttackPlayer('canopyPanther')).toBe(false);
    expect(canFaunaAttackPlayer('highlandHawk')).toBe(false);
    expect(canFaunaAttackPlayer('saberOryx')).toBe(false);
    expect(canFaunaAttackPlayer('')).toBe(false);
    expect(canFaunaAttackPlayer(ENTITY_KIND.worker)).toBe(false);
  });

  it('keeps insects passive toward a low-damage colony even after S3 grace period expires', () => {
    const { host, state, data } = createPeacefulColonyHost('pristine-planet');
    const hiveId = spawnHiveEntity(state, { species: 'blackAnt', q: 10, r: 0, initialResidents: 6 }, 0, data);

    const dmg = computeColonyPlanetDamage(state, 0, data);
    expect(dmg.damageScore).toBeLessThan(PLANET_DAMAGE_AGGRESSION_THRESHOLD);
    expect(dmg.damagedEnough).toBe(false);

    // Advance past 3000 ticks (raid roll interval) with high synthetic thermal override check:
    // without crossing planet damage threshold, scheduled waves must not fire.
    state.meta.tick = 2999;
    host.step(1);
    expect(isHiveAggressiveToColony(state, hiveId, 0)).toBe(false);
    expect(getActiveCohorts(state)).toHaveLength(0);
  });

  it('activates insect aggression once deforestation, mining, or industrial pollution crosses the planet damage threshold', () => {
    const { host, state, data } = createPeacefulColonyHost('deforested-planet');
    const hiveId = spawnHiveEntity(state, { species: 'blackAnt', q: 8, r: 0, initialResidents: 6 }, 0, data);

    // Add 3 thermal generators (36 pts >= 25 threshold) + drained deposit
    for (let i = 0; i < 3; i++) {
      const id = state.meta.nextEntityId++;
      const row = insertRow(state.entities, id, 0);
      state.entities.cols.kind[row] = BUILDING_KIND.thermalGenerator;
      state.entities.cols.owner[row] = 0;
      state.entities.cols.hp[row] = 400;
      state.entities.cols.hpMax[row] = 400;
      state.entities.cols.progress[row] = 1;
      state.entities.cols.state[row] = ENTITY_STATE.active;
      placeSpawnedEntity(state.entities, row, -3 - i, 0, 0);
    }
    const hx = hexIndex(state.grid.radius);
    const depIdx = hx.indexOf(-2, 2);
    state.grid.layers.deposit[depIdx] = DEPOSIT.metals;
    state.grid.layers.richness[depIdx] = 3000;

    const afterInd = computeColonyPlanetDamage(state, 0, data);
    expect(afterInd.damagedEnough).toBe(true);
    expect(afterInd.depositsMined).toBeGreaterThanOrEqual(1);

    // Clear-cutting forest right next to the hive (q=6, r=0 is 2 tiles from hive at q=8, r=0) provokes habitat defense
    const fakeEvents = [
      {
        kind: 'tileStateChanged',
        severity: 'info' as const,
        atTick: 10,
        colonyIds: ['col_0'],
        data: { colonyIndex: 0, q: 6, r: 0, prevTerrain: 'forest', prevPrep: 'wild', terrain: 'flat', prep: 'flat', op: 'clear', count: 2 },
      },
    ];
    ingestEcologicalDamageEvents(state, 10, {
      dt: 1,
      tick: 10,
      flags: new Set(['W00', 'W01', 'W02', 'W03', 'W04', 'W05', 'W06', 'W07']),
      data,
      events: fakeEvents,
      postings: [],
      record: () => {},
      rng: () => state.rng.misc,
      newEntityId: () => state.meta.nextEntityId++,
      emit: () => {},
    });

    const afterClear = computeColonyPlanetDamage(state, 0, data);
    expect(afterClear.forestCleared).toBe(2);
    expect(afterClear.scheduledRaidBonus).toBeGreaterThan(0);
    expect(isHiveAggressiveToColony(state, hiveId, 0)).toBe(true);
    expect(getActiveCohorts(state).length).toBeGreaterThanOrEqual(1);
    void host;
  });
});
