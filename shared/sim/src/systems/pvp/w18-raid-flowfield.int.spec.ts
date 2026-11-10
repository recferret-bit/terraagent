import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  createState,
  ensureColonyRecord,
  ENTITY_KIND,
  ENTITY_STATE,
  footprintAttackRange,
  hexDistance,
  insertRow,
  placeSpawnedEntity,
  PREP,
  rowOf,
  SimHost,
  TERRAIN,
  type PlanetState,
} from '../../index';
import { readDiplomacyBlob, writeDiplomacyBlob } from '../diplomacy/store';
import { setColonyShieldHours } from './shield';

function addEntity(
  state: PlanetState,
  spec: { kind: number; owner: number; q: number; r: number; hp?: number; state?: number; fw?: number },
): number {
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, state.meta.tick);
  state.entities.cols.kind[row] = spec.kind;
  state.entities.cols.owner[row] = spec.owner;
  state.entities.cols.hp[row] = spec.hp ?? 300;
  state.entities.cols.hpMax[row] = spec.hp ?? 300;
  state.entities.cols.state[row] = spec.state ?? ENTITY_STATE.idle;
  if (spec.fw) {
    state.entities.cols.footprintW[row] = spec.fw;
    state.entities.cols.footprintD[row] = spec.fw;
  }
  placeSpawnedEntity(state.entities, row, spec.q, spec.r, state.meta.tick);
  return id;
}

describe('W18-30 · SimHost integration: 6-unit Raid Colony flow-field march & footprintAttackRange', () => {
  it('Enqueue Raid Colony on B with 6 units → raid group marches via moveGroup flow-field slots, stops at footprintAttackRange of spotted B structures, and respects truce/shield gates', () => {
    const sim = new SimHost({ flags: parseWaves('..18') });
    const state = createState({ planetId: 'pl-w18-30-int', planetType: 'temperate', seed: 'w18-30-int', radius: 28 });
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

    const unitIds = [
      addEntity(state, { kind: ENTITY_KIND.recon, owner: 0, q: 0, r: 0, hp: 300 }),
      addEntity(state, { kind: ENTITY_KIND.recon, owner: 0, q: 0, r: 1, hp: 300 }),
      addEntity(state, { kind: ENTITY_KIND.recon, owner: 0, q: 1, r: 0, hp: 300 }),
      addEntity(state, { kind: ENTITY_KIND.recon, owner: 0, q: -1, r: 0, hp: 300 }),
      addEntity(state, { kind: ENTITY_KIND.recon, owner: 0, q: 0, r: -1, hp: 300 }),
      addEntity(state, { kind: ENTITY_KIND.recon, owner: 0, q: 1, r: -1, hp: 300 }),
    ];

    // Colony B 2x2 Supply Depot at (14, 0) (beyond initial 9-tile engage radius so all 6 march together first)
    const depotId = addEntity(state, {
      kind: ENTITY_KIND.supplyDepot,
      owner: 1,
      q: 14,
      r: 0,
      hp: 4000,
      state: ENTITY_STATE.active,
      fw: 2,
    });

    // Shield gate: when B is shielded, enqueueTask(raid) is rejected raid_protected
    setColonyShieldHours(state, 1, 4, 0);
    sim.submit({
      commandId: 'cmd_raid_shielded',
      colonyIndex: 0,
      source: 'player',
      kind: 'enqueueTask',
      args: { task: { kind: 'raid', targetColonyId: 'col_1' } },
    });
    expect(sim.step(1).outcomes[0]?.code).toBe('raid_protected');
    setColonyShieldHours(state, 1, 0, sim.tick);

    // Truce gate: when truce is active, enqueueTask(raid) is rejected truce_active
    const dip = readDiplomacyBlob(state);
    dip.truces['t_0_1'] = {
      truceId: 't_0_1', colonyA: 0, colonyB: 1, colonyAIndex: 0, colonyBIndex: 1,
      colonyAId: 'col_0', colonyBId: 'col_1', hours: 6, durationHours: 6,
      signedAtTick: sim.tick, startedAtTick: sim.tick, expiresAtTick: sim.tick + 1000, status: 'active',
    };
    writeDiplomacyBlob(state, dip, sim.tick);
    sim.submit({
      commandId: 'cmd_raid_truce', colonyIndex: 0, source: 'player',
      kind: 'enqueueTask', args: { task: { kind: 'raid', targetColonyId: 'col_1' } },
    });
    expect(sim.step(1).outcomes[0]?.code).toBe('truce_active');
    delete dip.truces['t_0_1'];
    writeDiplomacyBlob(state, dip, sim.tick);

    // Enqueue Raid Colony on B with 6 units
    sim.submit({
      commandId: 'cmd_raid_6', colonyIndex: 0, source: 'player',
      kind: 'enqueueTask', args: { task: { kind: 'raid', targetColonyId: 'col_1' } },
    });
    expect(sim.step(1).outcomes[0]?.code).toBeUndefined();

    // Verify groupMarch flow-field was created with 6 slots
    const groupMarchBlob = state.blobs.groupMarch?.value as
      | { marches?: Record<string, { slots?: Record<string, { q: number; r: number }> }> }
      | undefined;
    const marches = Object.values(groupMarchBlob?.marches ?? {});
    expect(marches.length).toBeGreaterThanOrEqual(1);
    expect(Object.keys(marches[0]!.slots ?? {}).length).toBe(6);

    // Step 30 ticks: raiders march via flow-field and stop at footprintAttackRange(4, 2) = 5 of B's 2x2 depot
    const maxStoppingDist = footprintAttackRange(4, 2);
    for (let i = 0; i < 30; i++) {
      sim.step(1);
    }

    const depotRow = rowOf(state.entities, depotId);
    expect(state.entities.cols.hp[depotRow]!).toBeLessThan(4000);
    for (const id of unitIds) {
      const r = rowOf(state.entities, id);
      const d = hexDistance(state.entities.cols.q[r]!, state.entities.cols.r[r]!, 14, 0);
      expect(d).toBeLessThanOrEqual(maxStoppingDist);
    }
  });
});
