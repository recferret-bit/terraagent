import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  createState,
  ensureColonyAt,
  ENTITY_KIND,
  ENTITY_STATE,
  insertRow,
  placeSpawnedEntity,
  PREP,
  SimHost,
  TERRAIN,
  TICKS_PER_SECOND,
  type PlanetState,
} from '../../index';
import { readDiplomacyBlob, writeDiplomacyBlob } from '../diplomacy/store';
import { getUnitSiphonedAmount } from './siphon';

function addEntity(
  state: PlanetState,
  spec: { kind: number; owner: number; q: number; r: number; hp?: number; state?: number; fw?: number },
): number {
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, state.meta.tick);
  state.entities.cols.kind[row] = spec.kind;
  state.entities.cols.owner[row] = spec.owner;
  state.entities.cols.hp[row] = spec.hp ?? 2000;
  state.entities.cols.hpMax[row] = spec.hp ?? 2000;
  state.entities.cols.state[row] = spec.state ?? ENTITY_STATE.active;
  if (spec.fw) {
    state.entities.cols.footprintW[row] = spec.fw;
    state.entities.cols.footprintD[row] = spec.fw;
  }
  placeSpawnedEntity(state.entities, row, spec.q, spec.r, state.meta.tick);
  return id;
}

describe('W18-05 · SimHost integration: Depot/Hub siphon 1/s per Recon, cap 40 & family cap', () => {
  it("Park 2 Recons beside B's depot for 10 s → A gains 20 of each sub-resource B holds, B loses 20", () => {
    const sim = new SimHost({ flags: parseWaves('..18') });
    const state = createState({ planetId: 'pl-w18-05-int1', planetType: 'temperate', seed: 'w18-05-int1', radius: 24 });
    state.grid.layers.terrain.fill(TERRAIN.flat);
    state.grid.layers.prep.fill(PREP.wild);
    sim.load(state);

    const colA = ensureColonyAt(state, 0, 0);
    colA.id = 'col_0';
    colA.status = 'active';
    colA.stage = 4;
    colA.stock['metals.t1'] = 100;
    colA.stock['minerals.t1'] = 50;
    colA.stock['bio.water'] = 30;
    colA.stock['bio.biomass'] = 20;

    const colB = ensureColonyAt(state, 1, 0);
    colB.id = 'col_1';
    colB.status = 'active';
    colB.stage = 4;
    colB.stock['metals.t1'] = 200;
    colB.stock['minerals.t1'] = 150;
    colB.stock['bio.water'] = 100;
    colB.stock['bio.biomass'] = 80;

    // Colony B Supply Depot at (6, 0) and 2 Colony A Recons parked beside it at (5, 0) and (5, 1)
    addEntity(state, { kind: ENTITY_KIND.supplyDepot, owner: 1, q: 6, r: 0, hp: 3000, fw: 2 });
    const r1 = addEntity(state, { kind: ENTITY_KIND.recon, owner: 0, q: 5, r: 0, hp: 400 });
    const r2 = addEntity(state, { kind: ENTITY_KIND.recon, owner: 0, q: 5, r: 1, hp: 400 });

    // Step 10 seconds (50 ticks at 5 Hz)
    const ticks10s = 10 * TICKS_PER_SECOND;
    for (let i = 0; i < ticks10s; i++) {
      sim.step(1);
    }

    expect(colA.stock['metals.t1']).toBe(120);
    expect(colA.stock['minerals.t1']).toBe(70);
    expect(colA.stock['bio.water']).toBe(50);
    expect(colA.stock['bio.biomass']).toBe(40);

    expect(colB.stock['metals.t1']).toBe(180);
    expect(colB.stock['minerals.t1']).toBe(130);
    expect(colB.stock['bio.water']).toBe(80);
    expect(colB.stock['bio.biomass']).toBe(60);

    expect(getUnitSiphonedAmount(state, 0, r1, 'metals.t1')).toBeCloseTo(10, 5);
    expect(getUnitSiphonedAmount(state, 0, r2, 'metals.t1')).toBeCloseTo(10, 5);
  });
});

describe('W18-05 · SimHost integration: siphon carry cap (40), family storage cap & truce block', () => {
  it('clamps siphon to unit carry cap (40), attacker family cap, and stops during active truce', () => {
    const sim = new SimHost({ flags: parseWaves('..18') });
    const state = createState({ planetId: 'pl-w18-05-int2', planetType: 'temperate', seed: 'w18-05-int2', radius: 24 });
    state.grid.layers.terrain.fill(TERRAIN.flat);
    state.grid.layers.prep.fill(PREP.wild);
    sim.load(state);

    const colA = ensureColonyAt(state, 0, 0);
    colA.status = 'active';
    colA.stage = 4;
    colA.caps.metals = 500;
    colA.caps.minerals = 500;
    colA.stock['metals.t1'] = 490; // Only 10 room left under metals family cap!
    colA.stock['minerals.t1'] = 0;

    const colB = ensureColonyAt(state, 1, 0);
    colB.status = 'active';
    colB.stage = 4;
    colB.stock['metals.t1'] = 200;
    colB.stock['minerals.t1'] = 200;

    addEntity(state, { kind: ENTITY_KIND.commandHub, owner: 1, q: 6, r: 0, hp: 5000, fw: 3 });
    const r1 = addEntity(state, { kind: ENTITY_KIND.recon, owner: 0, q: 5, r: 0, hp: 400 });

    // Step 50 seconds (250 ticks): 1 Recon attempts to siphon 50 units, but caps at 10 for metals (family cap) and 40 for minerals (carry cap)
    for (let i = 0; i < 50 * TICKS_PER_SECOND; i++) {
      sim.step(1);
    }

    expect(colA.stock['metals.t1']).toBe(500);
    expect(colB.stock['metals.t1']).toBe(190);
    expect(colA.stock['minerals.t1']).toBe(40);
    expect(colB.stock['minerals.t1']).toBe(160);
    expect(getUnitSiphonedAmount(state, 0, r1, 'minerals.t1')).toBeCloseTo(40, 5);

    // Sign an active truce and add a fresh Recon r2: no siphoning occurs while truce is active
    const r2 = addEntity(state, { kind: ENTITY_KIND.recon, owner: 0, q: 5, r: 1, hp: 400 });
    const dip = readDiplomacyBlob(state);
    dip.truces['truce_0_1'] = {
      truceId: 'truce_0_1',
      colonyA: 0,
      colonyB: 1,
      colonyAIndex: 0,
      colonyBIndex: 1,
      colonyAId: 'col_0',
      colonyBId: 'col_1',
      hours: 6,
      durationHours: 6,
      signedAtTick: sim.tick,
      startedAtTick: sim.tick,
      expiresAtTick: sim.tick + 50_000,
      status: 'active',
    };
    writeDiplomacyBlob(state, dip, sim.tick);

    for (let i = 0; i < 10 * TICKS_PER_SECOND; i++) {
      sim.step(1);
    }
    expect(colA.stock['minerals.t1']).toBe(40);
    expect(colB.stock['minerals.t1']).toBe(160);
    expect(getUnitSiphonedAmount(state, 0, r2, 'minerals.t1')).toBe(0);
  });
});
