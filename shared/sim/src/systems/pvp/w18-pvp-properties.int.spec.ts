import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  createState,
  ensureColonyAt,
  ENTITY_KIND,
  ENTITY_STATE,
  insertRow,
  isColonyRaidProtected,
  placeSpawnedEntity,
  PREP,
  rowOf,
  SimHost,
  TERRAIN,
  TICKS_PER_SECOND,
  type PlanetState,
} from '../../index';
import { applyAutopilot, openAwaySession } from '../away';
import { readDiplomacyBlob } from '../diplomacy/store';

function addEntity(
  state: PlanetState,
  spec: { kind: number; owner: number; q: number; r: number; hp?: number; state?: number },
): number {
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, state.meta.tick);
  state.entities.cols.kind[row] = spec.kind;
  state.entities.cols.owner[row] = spec.owner;
  state.entities.cols.hp[row] = spec.hp ?? 500;
  state.entities.cols.hpMax[row] = spec.hp ?? 500;
  state.entities.cols.state[row] = spec.state ?? ENTITY_STATE.active;
  placeSpawnedEntity(state.entities, row, spec.q, spec.r, state.meta.tick);
  return id;
}

describe('W18-27 · SimHost integration: AC-06, AC-12, AC-13 & Elimination timer', () => {
  it('verifies AC-06 shield rejection, AC-12 truce no-damage, AC-13 away cancel block, and critical -> eliminated in SimHost', () => {
    const sim = new SimHost({ flags: parseWaves('..18') });
    const state = createState({ planetId: 'pl-w18-27-int', planetType: 'temperate', seed: 'w18-27-int', radius: 28 });
    state.grid.layers.terrain.fill(TERRAIN.flat);
    state.grid.layers.prep.fill(PREP.wild);
    sim.load(state);

    const col0 = ensureColonyAt(state, 0, 0);
    col0.id = 'col_0';
    col0.status = 'active';
    col0.stage = 4;

    const col1 = ensureColonyAt(state, 1, 0);
    col1.id = 'col_1';
    col1.status = 'active';
    col1.stage = 3; // S3 newcomer with 6h shield

    addEntity(state, { kind: ENTITY_KIND.hq, owner: 0, q: 0, r: 0, hp: 900, state: ENTITY_STATE.idle });
    const r0 = addEntity(state, { kind: ENTITY_KIND.recon, owner: 0, q: 1, r: 0, hp: 200, state: ENTITY_STATE.idle });
    addEntity(state, { kind: ENTITY_KIND.hq, owner: 1, q: 12, r: 0, hp: 900, state: ENTITY_STATE.idle });
    const r1 = addEntity(state, { kind: ENTITY_KIND.recon, owner: 1, q: 11, r: 0, hp: 200, state: ENTITY_STATE.idle });

    sim.step(1);

    // AC-06: Colony 1 is protected by newcomer shield; raid from Colony 0 is rejected raid_protected
    expect(isColonyRaidProtected(state, 1, sim.tick)).toBe(true);
    sim.submit({
      commandId: 'ac06_raid', colonyIndex: 0, source: 'player',
      kind: 'raid', args: { targetColonyId: 'col_1' },
    });
    expect(sim.step(1).outcomes[0]?.code).toBe('raid_protected');

    // Colony 1 reaches S4 -> shield drops; now propose & accept a 6h truce (AC-12)
    col1.stage = 4;
    sim.step(1);
    expect(isColonyRaidProtected(state, 1, sim.tick)).toBe(false);

    sim.submit({
      commandId: 'ac12_prop', colonyIndex: 0, source: 'player',
      kind: 'diplomacy.proposeTruce', args: { toColony: 1, hours: 6 },
    });
    expect(sim.step(1).outcomes[0]?.code).toBeUndefined();
    const offerId = Object.keys(readDiplomacyBlob(state).offers)[0] ?? 'truce_offer_1';

    // AC-13: Put Colony 1 into away mode; AI accepts the truce offer, then AI attempt to cancel is rejected away_policy
    applyAutopilot(state, 1, { mode: 'director', awayRaids: true });
    openAwaySession(state, 1, 'col_1', { metals: 0, minerals: 0, bio: 0 }, sim.tick);
    sim.submit({
      commandId: 'ac13_accept', colonyIndex: 1, source: 'ai',
      kind: 'diplomacy.respondTruce', args: { offerId, accept: true },
    });
    expect(sim.step(1).outcomes[0]?.code).toBeUndefined();
    const truceId = Object.keys(readDiplomacyBlob(state).truces)[0] ?? 'truce_1';

    sim.submit({
      commandId: 'ac13_cancel', colonyIndex: 1, source: 'ai',
      kind: 'diplomacy.cancelTruce', args: { truceId },
    });
    expect(sim.step(1).outcomes[0]?.code).toBe('away_policy');

    // AC-12: Spawn adjacent units during active truce -> neither takes damage
    const r0b = addEntity(state, { kind: ENTITY_KIND.recon, owner: 0, q: 5, r: 0, hp: 200, state: ENTITY_STATE.idle });
    const r1b = addEntity(state, { kind: ENTITY_KIND.recon, owner: 1, q: 6, r: 0, hp: 200, state: ENTITY_STATE.idle });
    for (let i = 0; i < 10; i++) sim.step(1);
    expect(state.entities.cols.hp[rowOf(state.entities, r0b)]).toBe(200);
    expect(state.entities.cols.hp[rowOf(state.entities, r1b)]).toBe(200);
    expect(state.entities.cols.hp[rowOf(state.entities, r0)]).toBe(200);
    expect(state.entities.cols.hp[rowOf(state.entities, r1)]).toBe(200);

    // Elimination timer: Colony 2 loses its Hub and expires its 10-min critical timer
    const col2 = ensureColonyAt(state, 2, sim.tick);
    col2.id = 'col_2';
    col2.status = 'active';
    col2.stage = 3;
    addEntity(state, { kind: ENTITY_KIND.commandHub, owner: 2, q: -10, r: 0, hp: 1500 });
    addEntity(state, { kind: ENTITY_KIND.hq, owner: 2, q: -9, r: 0, hp: 900 });
    sim.submit({ commandId: 'kill_hub_2', colonyIndex: 2, source: 'player', kind: 'dev.killHub', args: { colonyIndex: 2 } });
    sim.step(1);
    expect(col2.status).toBe('critical');
    sim.step(600 * TICKS_PER_SECOND + 1);
    expect(col2.status).toBe('eliminated');
  });
});
