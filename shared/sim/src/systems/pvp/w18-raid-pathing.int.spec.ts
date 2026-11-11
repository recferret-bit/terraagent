import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  createState,
  ensureColonyRecord,
  ENTITY_KIND,
  ENTITY_STATE,
  getPvpState,
  hexDistance,
  insertRow,
  placeSpawnedEntity,
  PREP,
  removeRow,
  rowOf,
  SimHost,
  TERRAIN,
  type PlanetState,
} from '../../index';

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

describe('W18-04 · SimHost integration: raid pathing frontier defenses -> depot & raidRepelled', () => {
  it('Raid a foreign colony → army paths to its spotted frontier structure first, then advances to its depot', () => {
    const sim = new SimHost({ flags: parseWaves('..18') });
    const state = createState({ planetId: 'pl-w18-04-int', planetType: 'temperate', seed: 'w18-04-int', radius: 28 });
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

    const r1 = addEntity(state, { kind: ENTITY_KIND.recon, owner: 0, q: 0, r: 0, hp: 400, state: ENTITY_STATE.idle });
    const r2 = addEntity(state, { kind: ENTITY_KIND.recon, owner: 0, q: 0, r: 1, hp: 400, state: ENTITY_STATE.idle });

    // Spotted frontier turret at (6, 0) and supplyDepot behind it at (11, 0)
    const turretId = addEntity(state, {
      kind: ENTITY_KIND.autocannon,
      owner: 1,
      q: 6,
      r: 0,
      hp: 70,
      state: ENTITY_STATE.offlineUnpowered,
    });
    const depotId = addEntity(state, {
      kind: ENTITY_KIND.supplyDepot,
      owner: 1,
      q: 11,
      r: 0,
      hp: 500,
      state: ENTITY_STATE.active,
    });

    sim.step(1);

    sim.submit({
      commandId: 'cmd_raid_w18_04',
      colonyIndex: 0,
      source: 'player',
      kind: 'raid',
      args: { targetColonyId: 'col_1' },
    });
    expect(sim.step(1).outcomes[0]?.code).toBeUndefined();

    const raids = Object.values(getPvpState(state).activeRaids);
    expect(raids.length).toBe(1);
    expect(raids[0]!.currentTargetEntityId).toBe(turretId);

    // Step until the frontier turret is destroyed, then verify raid retargets the supplyDepot
    for (let i = 0; i < 40; i++) {
      sim.step(1);
    }
    expect(rowOf(state.entities, turretId)).toBe(-1);

    const activeAfterTurret = Object.values(getPvpState(state).activeRaids);
    expect(activeAfterTurret.length).toBe(1);
    expect(activeAfterTurret[0]!.currentTargetEntityId).toBe(depotId);

    const r1Row = rowOf(state.entities, r1);
    const r2Row = rowOf(state.entities, r2);
    expect(hexDistance(state.entities.cols.q[r1Row]!, state.entities.cols.r[r1Row]!, 11, 0)).toBeLessThanOrEqual(4);
    expect(hexDistance(state.entities.cols.q[r2Row]!, state.entities.cols.r[r2Row]!, 11, 0)).toBeLessThanOrEqual(4);

    // Eliminate raiders and verify raidRepelled is emitted
    removeRow(state.entities, r1, sim.tick);
    removeRow(state.entities, r2, sim.tick);
    const repelStep = sim.step(1);
    expect(repelStep.events.some((e) => e.kind === 'raidRepelled')).toBe(true);
    expect(Object.keys(getPvpState(state).activeRaids).length).toBe(0);
  });
});
