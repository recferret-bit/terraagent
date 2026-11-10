import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  createState,
  ensureColonyAt,
  ENTITY_KIND,
  ENTITY_STATE,
  insertRow,
  onHqDestroyed,
  onHubDestroyed,
  placeSpawnedEntity,
  PREP,
  removeRow,
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

describe('W18-28 · Deterministic raid → siphon → repel flow & 100 s ruins decay unit test (SIM §7.7, DI-16, DI-23)', () => {
  it('asserts exact resource deltas during deterministic raid → siphon → repel flow', () => {
    const sim = new SimHost({ flags: parseWaves('..18') });
    const state = createState({
      planetId: 'pl-w18-28-u1',
      planetType: 'temperate',
      seed: 'w18-28-deterministic-seed',
      radius: 28,
    });
    state.grid.layers.terrain.fill(TERRAIN.flat);
    state.grid.layers.prep.fill(PREP.wild);
    sim.load(state);

    const colA = ensureColonyAt(state, 0, 0);
    colA.id = 'col_0';
    colA.status = 'active';
    colA.stage = 4;
    colA.stock['metals.t1'] = 100;
    colA.stock['minerals.t1'] = 80;
    colA.stock['bio.water'] = 60;
    colA.stock['bio.biomass'] = 40;

    const colB = ensureColonyAt(state, 1, 0);
    colB.id = 'col_1';
    colB.status = 'active';
    colB.stage = 4;
    colB.stock['metals.t1'] = 250;
    colB.stock['minerals.t1'] = 180;
    colB.stock['bio.water'] = 120;
    colB.stock['bio.biomass'] = 90;

    // Colony B Supply Depot at (6, 0) and 2 Colony A Recons at (5, 0) and (5, 1)
    addEntity(state, { kind: ENTITY_KIND.supplyDepot, owner: 1, q: 6, r: 0, hp: 4000, fw: 2 });
    const r1 = addEntity(state, { kind: ENTITY_KIND.recon, owner: 0, q: 5, r: 0, hp: 300, state: ENTITY_STATE.idle });
    const r2 = addEntity(state, { kind: ENTITY_KIND.recon, owner: 0, q: 5, r: 1, hp: 300, state: ENTITY_STATE.idle });

    sim.submit({
      commandId: 'cmd_raid_w18_28',
      colonyIndex: 0,
      source: 'player',
      kind: 'raid',
      args: { targetColonyId: 'col_1' },
    });
    const startRes = sim.step(1);
    expect(startRes.outcomes[0]?.code).toBeUndefined();
    expect(startRes.events.some((e) => e.kind === 'raidStarted')).toBe(true);

    // Step 49 more ticks (total 50 ticks = 10 s of siphon with 2 Recons = +20 / -20 per held sub-resource)
    for (let i = 0; i < 10 * TICKS_PER_SECOND - 1; i++) {
      sim.step(1);
    }

    expect(colA.stock['metals.t1']).toBe(120);
    expect(colA.stock['minerals.t1']).toBe(100);
    expect(colA.stock['bio.water']).toBe(80);
    expect(colA.stock['bio.biomass']).toBe(60);

    expect(colB.stock['metals.t1']).toBe(230);
    expect(colB.stock['minerals.t1']).toBe(160);
    expect(colB.stock['bio.water']).toBe(100);
    expect(colB.stock['bio.biomass']).toBe(70);

    // Repel the raid by destroying both raiders -> raidRepelled event emitted
    removeRow(state.entities, r1, sim.tick);
    removeRow(state.entities, r2, sim.tick);
    const repelRes = sim.step(1);
    expect(repelRes.events.some((e) => e.kind === 'raidRepelled')).toBe(true);
  });
});

describe('W18-28 · 100 s ruins decay unit test (DI-23)', () => {
  it('asserts ruin HP decay at 1 % HP/s over 100 s until ruins crumble to 0 and are removed', () => {
    const sim = new SimHost({ flags: parseWaves('..18') });
    const state = createState({
      planetId: 'pl-w18-28-u2',
      planetType: 'temperate',
      seed: 'w18-28-ruins-seed',
      radius: 24,
    });
    state.grid.layers.terrain.fill(TERRAIN.flat);
    state.grid.layers.prep.fill(PREP.wild);
    sim.load(state);

    const colB = ensureColonyAt(state, 1, 0);
    colB.id = 'col_1';
    colB.status = 'active';
    colB.stage = 3;

    const hubId = addEntity(state, { kind: ENTITY_KIND.commandHub, owner: 1, q: 4, r: 0, hp: 1500 });
    const hqId = addEntity(state, { kind: ENTITY_KIND.hq, owner: 1, q: 5, r: 0, hp: 900 });
    const depotId = addEntity(state, { kind: ENTITY_KIND.supplyDepot, owner: 1, q: 7, r: 0, hp: 1000 });
    const solarId = addEntity(state, { kind: ENTITY_KIND.solar, owner: 1, q: 9, r: 0, hp: 500 });

    // Destroy Hub and HQ -> Colony B is eliminated immediately; depot & solar become neutral ruins (owner = -1)
    removeRow(state.entities, hubId, sim.tick);
    onHubDestroyed(state, 1, hubId, sim.tick);
    removeRow(state.entities, hqId, sim.tick);
    onHqDestroyed(state, 1, hqId, { tick: sim.tick });

    expect(colB.status).toBe('eliminated');
    expect(state.entities.cols.owner[rowOf(state.entities, depotId)]).toBe(-1);
    expect(state.entities.cols.owner[rowOf(state.entities, solarId)]).toBe(-1);

    // After 50 s (250 ticks), ruins have lost 50% of hpMax
    for (let i = 0; i < 50 * TICKS_PER_SECOND; i++) {
      sim.step(1);
    }
    expect(state.entities.cols.hp[rowOf(state.entities, depotId)]).toBeCloseTo(500, 3);
    expect(state.entities.cols.hp[rowOf(state.entities, solarId)]).toBeCloseTo(250, 3);

    // After 100 s total (another 250 ticks), ruins reach 0 HP and are removed
    for (let i = 0; i < 50 * TICKS_PER_SECOND; i++) {
      sim.step(1);
    }
    expect(rowOf(state.entities, depotId)).toBe(-1);
    expect(rowOf(state.entities, solarId)).toBe(-1);
  });
});
