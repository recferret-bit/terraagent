import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  createState,
  ensureColonyRecord,
  ENTITY_KIND,
  ENTITY_STATE,
  hexDistance,
  hexIndex,
  insertRow,
  placeSpawnedEntity,
  PREP,
  rowOf,
  SimHost,
  TERRAIN,
  type PlanetState,
} from '../../index';
import { isColonyRaidProtected, setColonyShieldHours } from './shield';

function addEntity(
  state: PlanetState,
  spec: { kind: number; owner: number; q: number; r: number; hp: number; state: number },
): number {
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, state.meta.tick);
  state.entities.cols.kind[row] = spec.kind;
  state.entities.cols.owner[row] = spec.owner;
  state.entities.cols.hp[row] = spec.hp;
  state.entities.cols.hpMax[row] = spec.hp;
  state.entities.cols.state[row] = spec.state;
  placeSpawnedEntity(state.entities, row, spec.q, spec.r, state.meta.tick);
  return id;
}

describe('W18-03 · SimHost integration: attackMove into foreign colony territory (UO-W-08)', () => {
  it('Attack-move to a tile in B → units stop to kill a B turret on the path, then continue to the target tile', () => {
    const sim = new SimHost({ flags: parseWaves('..18') });
    const state = createState({ planetId: 'pl-w18-03', planetType: 'temperate', seed: 'w18-03-int-seed', radius: 28 });
    state.grid.layers.terrain.fill(TERRAIN.flat);
    state.grid.layers.prep.fill(PREP.wild);
    sim.load(state);

    const col0 = ensureColonyRecord(state, 0, 0);
    col0.id = 'col_0';
    col0.status = 'active';
    col0.stage = 4;

    const col1 = ensureColonyRecord(state, 1, 0);
    col1.id = 'col_1';
    col1.status = 'active';
    col1.stage = 4;

    const idx = hexIndex(state.grid.radius);
    for (let q = 6; q <= 14; q++) {
      const t = idx.indexOf(q, 0);
      if (t >= 0) state.grid.layers.owner[t] = 1;
    }

    const r1 = addEntity(state, { kind: ENTITY_KIND.recon, owner: 0, q: 0, r: 0, hp: 400, state: ENTITY_STATE.idle });
    const r2 = addEntity(state, { kind: ENTITY_KIND.recon, owner: 0, q: 0, r: 1, hp: 400, state: ENTITY_STATE.idle });

    // Colony B turret along the path at (6, 0) with low HP so units kill it quickly and continue to (11, 0)
    const turretId = addEntity(state, {
      kind: ENTITY_KIND.autocannon,
      owner: 1,
      q: 6,
      r: 0,
      hp: 80,
      state: ENTITY_STATE.offlineUnpowered,
    });

    sim.step(1);

    sim.submit({
      commandId: 'cmd_am_foreign',
      colonyIndex: 0,
      source: 'player',
      kind: 'attackMove',
      args: { entityIds: [r1, r2], q: 11, r: 0 },
    });
    expect(sim.step(1).outcomes[0]?.code).toBeUndefined();

    let engagedTurret = false;
    let turretKilledTick = -1;
    for (let step = 0; step < 80; step++) {
      sim.step(1);
      const tRow = rowOf(state.entities, turretId);
      if (tRow >= 0 && state.entities.cols.hp[tRow]! < 80 && state.entities.cols.hp[tRow]! > 0) {
        engagedTurret = true;
      }
      if ((tRow < 0 || state.entities.cols.hp[tRow]! <= 0) && turretKilledTick < 0) {
        engagedTurret = true;
        turretKilledTick = sim.tick;
        break;
      }
    }

    expect(engagedTurret).toBe(true);
    expect(turretKilledTick).toBeGreaterThan(0);

    const r1Row = rowOf(state.entities, r1);
    const distAtKill = hexDistance(state.entities.cols.q[r1Row]!, state.entities.cols.r[r1Row]!, 11, 0);
    expect(distAtKill).toBeGreaterThan(0);

    // Continue stepping: units resume march after killing B's turret and arrive at (11, 0)
    for (let i = 0; i < 30; i++) {
      sim.step(1);
    }
    const finalDist = hexDistance(state.entities.cols.q[r1Row]!, state.entities.cols.r[r1Row]!, 11, 0);
    expect(finalDist).toBeLessThanOrEqual(1);
  });
});

describe('W18-03 · SimHost integration: attackMove shield drop', () => {
  it('drops attacker newcomer shield when attack-moving into unshielded foreign territory', () => {
    const sim = new SimHost({ flags: parseWaves('..18') });
    const state = createState({ planetId: 'pl-w18-03-sh', planetType: 'temperate', seed: 'w18-03-shield-drop', radius: 24 });
    state.grid.layers.terrain.fill(TERRAIN.flat);
    state.grid.layers.prep.fill(PREP.wild);
    sim.load(state);

    const col0 = ensureColonyRecord(state, 0, 0);
    col0.status = 'active';
    col0.stage = 2;
    setColonyShieldHours(state, 0, 5, 0);

    const col1 = ensureColonyRecord(state, 1, 0);
    col1.status = 'active';
    col1.stage = 4;

    const tile = hexIndex(state.grid.radius).indexOf(8, 0);
    state.grid.layers.owner[tile] = 1;

    const r1 = addEntity(state, { kind: ENTITY_KIND.recon, owner: 0, q: 0, r: 0, hp: 220, state: ENTITY_STATE.idle });
    sim.step(1);
    expect(isColonyRaidProtected(state, 0, sim.tick)).toBe(true);

    sim.submit({
      commandId: 'cmd_am_drop_shield',
      colonyIndex: 0,
      source: 'player',
      kind: 'attackMove',
      args: { entityId: r1, q: 8, r: 0 },
    });
    expect(sim.step(1).outcomes[0]?.code).toBeUndefined();
    expect(isColonyRaidProtected(state, 0, sim.tick)).toBe(false);
  });
});
