import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  COMBAT_DRY_FIRE_BLOB,
  createPlanet,
  createRegistryPipeline,
  DEPOSIT,
  ensureColonyLedger,
  ensureColonyRecord,
  ENTITY_KIND,
  ENTITY_STATE,
  FIRING_RANGE_BLOB,
  getFaunaHivesState,
  insertRow,
  placeSpawnedEntity,
  PREP,
  rowOf,
  setBlob,
  spawnHiveSite,
  step,
  stepCombatTurrets,
  TERRAIN,
  type PlanetState,
  type StepContext,
} from '../../src';

function flatRangePlanet(): { state: PlanetState; flags: ReturnType<typeof parseWaves>; data: StepContext['data'] } {
  const flags = parseWaves('..07');
  const pipeline = createRegistryPipeline({ flags });
  const state = createPlanet({ type: 'flat', seed: 'dry-fire', radius: 8, planetId: 'dry-fire' });
  state.grid.layers.terrain.fill(TERRAIN.flat);
  state.grid.layers.prep.fill(PREP.prepared);
  state.grid.layers.height.fill(0);
  state.grid.layers.deposit.fill(DEPOSIT.none);
  state.grid.layers.owner.fill(-1);
  const colony = ensureColonyLedger(ensureColonyRecord(state, 0, 0));
  colony.status = 'active';
  colony.powerSupplyOverride = 800;
  spawnHiveSite(
    state,
    { species: 'blackAnt', q: -3, r: 0, entranceQ: -1, entranceR: 0, patrolRadius: 2, initialResidents: 1 },
    0,
    pipeline.config.data,
  );
  spawnActive(state, ENTITY_KIND.commandHub, 5, 0, 800, 3);
  spawnActive(state, ENTITY_KIND.laserTower, 2, 0, 400, 1);
  return { state, flags, data: pipeline.config.data };
}

function spawnActive(state: PlanetState, kind: number, q: number, r: number, hp: number, footprint: number): void {
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, 0);
  const cols = state.entities.cols;
  cols.kind[row] = kind;
  cols.owner[row] = 0;
  cols.hp[row] = hp;
  cols.hpMax[row] = hp;
  cols.state[row] = ENTITY_STATE.active;
  cols.footprintW[row] = footprint;
  cols.footprintD[row] = footprint;
  placeSpawnedEntity(state.entities, row, q, r, 0);
}

function bugHp(state: PlanetState): number {
  const id = Number(Object.keys(getFaunaHivesState(state).bugsById).sort((a, b) => Number(a) - Number(b))[0]);
  return state.entities.cols.hp[rowOf(state.entities, id)]!;
}

function turretContext(state: PlanetState, flags: ReturnType<typeof parseWaves>, data: StepContext['data']): { ctx: StepContext; events: string[] } {
  const events: string[] = [];
  const ctx: StepContext = {
    dt: 1,
    tick: 1,
    flags: new Set(flags.list),
    data,
    events: [],
    postings: [],
    rng: (stream) => state.rng[stream],
    newEntityId: () => state.meta.nextEntityId++,
    emit: (e) => { events.push(e.kind); },
    record: () => undefined,
  };
  return { ctx, events };
}

describe('firing range dry fire', () => {
  it('does not shoot a passive bug unless firing-range turrets mode is on', () => {
    const { state, flags, data } = flatRangePlanet();
    const { ctx, events } = turretContext(state, flags, data);
    stepCombatTurrets(state, ctx);
    expect(events).not.toContain('projectileFired');
    expect(bugHp(state)).toBeGreaterThan(0);
  });

  it('dry fire leaves bug HP unchanged while the laser tower still emits a shot', () => {
    const dry = flatRangePlanet();
    const before = bugHp(dry.state);
    setBlob(dry.state, COMBAT_DRY_FIRE_BLOB, true, 0);
    setBlob(dry.state, FIRING_RANGE_BLOB, { mode: 'turrets' }, 0);
    const shot = turretContext(dry.state, dry.flags, dry.data);
    stepCombatTurrets(dry.state, shot.ctx);
    expect(shot.events).toContain('projectileFired');
    expect(bugHp(dry.state)).toBe(before);

    const live = flatRangePlanet();
    const liveBefore = bugHp(live.state);
    setBlob(live.state, FIRING_RANGE_BLOB, { mode: 'turrets' }, 0);
    const liveShot = turretContext(live.state, live.flags, live.data);
    stepCombatTurrets(live.state, liveShot.ctx);
    expect(liveShot.events).toContain('projectileFired');
    expect(bugHp(live.state)).toBeLessThan(liveBefore);
  });

  it('a dry-fire planet step still emits a shot and does not change bug HP', () => {
    const { state, flags, data } = flatRangePlanet();
    const before = bugHp(state);
    setBlob(state, COMBAT_DRY_FIRE_BLOB, true, 0);
    setBlob(state, FIRING_RANGE_BLOB, { mode: 'turrets' }, 0);
    const pipeline = createRegistryPipeline({ flags, data });
    const kinds: string[] = [];
    for (let i = 0; i < 6; i++) {
      const result = step(state, [], 1, pipeline);
      for (const ev of result.events) kinds.push(ev.kind);
    }
    expect(kinds).toContain('projectileFired');
    expect(bugHp(state)).toBe(before);
  });
});
