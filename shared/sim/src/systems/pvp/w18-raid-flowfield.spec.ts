import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  compileData,
  createState,
  ensureColonyRecord,
  ENTITY_KIND,
  ENTITY_STATE,
  getMotion,
  getUnitStanceRecord,
  insertRow,
  placeSpawnedEntity,
  PREP,
  rowOf,
  seedStream,
  TERRAIN,
  type PlanetState,
  type StepContext,
} from '../../index';
import { orderRaidGroupFlowMarch } from './raidFlowMarch';

function makeStepCtx(state: PlanetState, tick = 1): StepContext {
  const flagSet = parseWaves('..18');
  return {
    dt: 1,
    tick,
    flags: flagSet as unknown as ReadonlySet<string>,
    data: compileData(flagSet),
    rng: (s) => seedStream(String(state.meta.seed), `${s}:${tick}`),
    newEntityId: () => state.meta.nextEntityId++,
    emit: () => {},
    events: [],
    record: () => {},
    postings: [],
  };
}

function addUnit(state: PlanetState, q: number, r: number, owner = 0): number {
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, 0);
  state.entities.cols.kind[row] = ENTITY_KIND.recon;
  state.entities.cols.owner[row] = owner;
  state.entities.cols.hp[row] = 160;
  state.entities.cols.hpMax[row] = 160;
  state.entities.cols.state[row] = ENTITY_STATE.idle;
  placeSpawnedEntity(state.entities, row, q, r, 0);
  return id;
}

describe('W18-30 · orderRaidGroupFlowMarch unit tests (moveGroup flow-field slots & D-43)', () => {
  it('assigns 6 distinct non-overlapping flow-field slots around the target and commits a shared groupMarch', () => {
    const state = createState({ planetId: 'pl-w18-30-u1', planetType: 'temperate', seed: 'w18-30-u1', radius: 24 });
    state.grid.layers.terrain.fill(TERRAIN.flat);
    state.grid.layers.prep.fill(PREP.wild);

    ensureColonyRecord(state, 0, 0).stage = 4;
    ensureColonyRecord(state, 1, 0).stage = 4;

    const unitIds = [
      addUnit(state, 0, 0),
      addUnit(state, 0, 1),
      addUnit(state, 1, 0),
      addUnit(state, -1, 0),
      addUnit(state, 0, -1),
      addUnit(state, 1, -1),
    ];

    const ctx = makeStepCtx(state, 1);
    const res = orderRaidGroupFlowMarch(state, unitIds, { q: 10, r: 0 }, ctx, 'together');
    expect(res.usedFlowField).toBe(true);
    expect(Object.keys(res.slotted).length).toBe(6);

    const slotCoords = new Set(Object.values(res.slotted).map((s) => `${s.q},${s.r}`));
    expect(slotCoords.size).toBe(6);

    const groupMarchBlob = state.blobs.groupMarch?.value as
      | { marches?: Record<string, { slots?: Record<string, { q: number; r: number }> }> }
      | undefined;
    expect(Object.keys(groupMarchBlob?.marches ?? {}).length).toBe(1);

    for (const id of unitIds) {
      const motion = getMotion(state, id);
      expect(motion).not.toBeNull();
      expect(getUnitStanceRecord(state, rowOf(state.entities, id)).attackMoveGoal).toEqual(res.slotted[id]);
    }
  });
});
