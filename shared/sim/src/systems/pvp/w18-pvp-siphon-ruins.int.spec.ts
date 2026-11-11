import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  createState,
  ensureColonyAt,
  ENTITY_KIND,
  ENTITY_STATE,
  hexIndex,
  insertRow,
  placeSpawnedEntity,
  PREP,
  rowOf,
  SimHost,
  TERRAIN,
  TICKS_PER_SECOND,
  type PlanetState,
} from '../../index';

function addEntity(
  state: PlanetState,
  spec: { kind: number; owner: number; q: number; r: number; hp?: number; state?: number; fw?: number },
): number {
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, state.meta.tick);
  state.entities.cols.kind[row] = spec.kind;
  state.entities.cols.owner[row] = spec.owner;
  state.entities.cols.hp[row] = spec.hp ?? 1000;
  state.entities.cols.hpMax[row] = spec.hp ?? 1000;
  state.entities.cols.state[row] = spec.state ?? ENTITY_STATE.active;
  if (spec.fw) {
    state.entities.cols.footprintW[row] = spec.fw;
    state.entities.cols.footprintD[row] = spec.fw;
  }
  placeSpawnedEntity(state.entities, row, spec.q, spec.r, state.meta.tick);
  return id;
}

describe('W18-28 · SimHost integration: full raid → siphon → HQ/Hub kill → 100 s ruins & territory revert', () => {
  it('executes raid siphon, eliminates target via dev.killHub + dev.killHq, and decays ruins + territory over 100 s', () => {
    const sim = new SimHost({ flags: parseWaves('..18') });
    const state = createState({
      planetId: 'pl-w18-28-int',
      planetType: 'temperate',
      seed: 'w18-28-int-seed',
      radius: 28,
    });
    state.grid.layers.terrain.fill(TERRAIN.flat);
    state.grid.layers.prep.fill(PREP.wild);
    sim.load(state);

    const colA = ensureColonyAt(state, 0, 0);
    colA.id = 'col_0';
    colA.status = 'active';
    colA.stage = 4;
    colA.stock['metals.t1'] = 50;

    const colB = ensureColonyAt(state, 1, 0);
    colB.id = 'col_1';
    colB.status = 'active';
    colB.stage = 4;
    colB.stock['metals.t1'] = 150;

    const idx = hexIndex(state.grid.radius);
    const ownedTile = idx.indexOf(8, 0);
    state.grid.layers.owner[ownedTile] = 1;
    state.grid.layers.anchors[ownedTile] = 1;

    addEntity(state, { kind: ENTITY_KIND.commandHub, owner: 1, q: 10, r: 0, hp: 1500, fw: 3 });
    addEntity(state, { kind: ENTITY_KIND.hq, owner: 1, q: 11, r: 0, hp: 900 });
    const depotId = addEntity(state, { kind: ENTITY_KIND.supplyDepot, owner: 1, q: 6, r: 0, hp: 3000, fw: 2 });

    addEntity(state, { kind: ENTITY_KIND.recon, owner: 0, q: 5, r: 0, hp: 300, state: ENTITY_STATE.idle });
    addEntity(state, { kind: ENTITY_KIND.recon, owner: 0, q: 5, r: 1, hp: 300, state: ENTITY_STATE.idle });

    // Siphon for 5 seconds (25 ticks) -> +10 / -10 metals.t1
    for (let i = 0; i < 5 * TICKS_PER_SECOND; i++) {
      sim.step(1);
    }
    expect(colA.stock['metals.t1']).toBe(60);
    expect(colB.stock['metals.t1']).toBe(140);

    // Eliminate Colony B via dev.killHub + dev.killHq
    sim.submit({ commandId: 'khub', colonyIndex: 1, source: 'player', kind: 'dev.killHub', args: { colonyIndex: 1 } });
    sim.submit({ commandId: 'khq', colonyIndex: 1, source: 'player', kind: 'dev.killHq', args: { colonyIndex: 1 } });
    sim.step(1);
    expect(colB.status).toBe('eliminated');

    const depotRow = rowOf(state.entities, depotId);
    expect(state.entities.cols.owner[depotRow]).toBe(-1);

    // Step 100 s (500 ticks): depot ruin decays at 1% HP/s to 0 and is removed, and territory reverts after 60 s grace
    for (let i = 0; i < 100 * TICKS_PER_SECOND; i++) {
      sim.step(1);
    }
    expect(rowOf(state.entities, depotId)).toBe(-1);
    expect(state.grid.layers.owner[ownedTile]).toBe(-1);
    expect(state.grid.layers.anchors[ownedTile]).toBe(0);
  });
});
