import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  ENTITY_KIND,
  ENTITY_STATE,
  createRegistryPipeline,
  createState,
  creditResource,
  ensureColonyLedger,
  insertRow,
  rowOf,
  step,
} from '../../src';

function createW03State(id: string) {
  const state = createState({ planetId: id, planetType: 'temperate', seed: 'w03-dev', radius: 10 });
  const colony = ensureColonyLedger({
    index: 0,
    id: 'col-0',
    name: 'Alpha',
    color: 0xff6b00,
    status: 'active',
    changedAt: 0,
  });
  state.colonies.push(colony);
  return { state, colony, pipeline: createRegistryPipeline({ flags: parseWaves('..03') }) };
}

describe('W03-27 Dev commands — dev.setwind, dev.drainfuel, dev.addload, dev.damage', () => {
  it('dev.setwind sets colony windFactor and wind blob percentage', () => {
    const { state, colony, pipeline } = createW03State('p-dev-wind');

    const res = step(
      state,
      [{ commandId: 'w-120', colonyIndex: 0, source: 'dev', kind: 'dev.setwind', args: { pct: 120 } }],
      1,
      pipeline,
    );
    expect(res.outcomes[0].code).toBeUndefined();
    expect((colony as { windFactor?: number }).windFactor).toBeCloseTo(1.2, 4);
    expect((state.blobs.wind?.value as { pct?: number })?.pct).toBe(120);
  });

  it('dev.drainfuel zeroes bio.biomass stock and transitions Thermal Plant to offlineNoFuel on the same tick', () => {
    const { state, colony, pipeline } = createW03State('p-dev-drainfuel');

    const hubRow = insertRow(state.entities, 1, 0);
    state.entities.cols.kind[hubRow] = ENTITY_KIND.commandHub;
    state.entities.cols.owner[hubRow] = 0;
    state.entities.cols.hp[hubRow] = 1000;
    state.entities.cols.state[hubRow] = ENTITY_STATE.active;

    const thRow = insertRow(state.entities, 2, 0);
    state.entities.cols.kind[thRow] = ENTITY_KIND.thermal;
    state.entities.cols.owner[thRow] = 0;
    state.entities.cols.q[thRow] = 2;
    state.entities.cols.r[thRow] = 0;
    state.entities.cols.hp[thRow] = 450;
    state.entities.cols.state[thRow] = ENTITY_STATE.active;

    creditResource(colony, 'bio.biomass', 100, 0);
    step(state, [], 1, pipeline);
    expect(state.entities.cols.state[rowOf(state.entities, 2)]).toBe(ENTITY_STATE.active);

    const drainRes = step(
      state,
      [{ commandId: 'df-1', colonyIndex: 0, source: 'dev', kind: 'dev.drainfuel', args: {} }],
      1,
      pipeline,
    );
    expect(drainRes.outcomes[0].code).toBeUndefined();
    expect(colony.stock['bio.biomass']).toBe(0);
    expect(state.entities.cols.state[rowOf(state.entities, 2)]).toBe(ENTITY_STATE.offlineNoFuel);
  });

  it('dev.addload records syntheticLoadPerS and dev.damage reduces entity HP by pct%', () => {
    const { state, colony, pipeline } = createW03State('p-dev-damage');

    const extRow = insertRow(state.entities, 10, 0);
    state.entities.cols.kind[extRow] = ENTITY_KIND.metalsExtractor;
    state.entities.cols.owner[extRow] = 0;
    state.entities.cols.hp[extRow] = 500;
    state.entities.cols.hpMax[extRow] = 500;
    state.entities.cols.state[extRow] = ENTITY_STATE.active;

    const loadRes = step(
      state,
      [{ commandId: 'al-1', colonyIndex: 0, source: 'dev', kind: 'dev.addload', args: { loadPerS: 90, entityId: 10 } }],
      1,
      pipeline,
    );
    expect(loadRes.outcomes[0].code).toBeUndefined();
    expect((colony as { syntheticLoadPerS?: number }).syntheticLoadPerS).toBe(90);

    // Damage 10 by 60% of 500 HP -> drops by 300 to 200 HP
    const dmg60 = step(
      state,
      [{ commandId: 'dmg-60', colonyIndex: 0, source: 'dev', kind: 'dev.damage', args: { entityId: 10, pct: 60 } }],
      1,
      pipeline,
    );
    expect(dmg60.outcomes[0].code).toBeUndefined();
    expect(state.entities.cols.hp[rowOf(state.entities, 10)]).toBe(200);

    // Damage 10 by 100% -> drops to 0 HP
    const dmg100 = step(
      state,
      [{ commandId: 'dmg-100', colonyIndex: 0, source: 'dev', kind: 'dev.damage', args: { entityId: 10, pct: 100 } }],
      1,
      pipeline,
    );
    expect(dmg100.outcomes[0].code).toBeUndefined();
    expect(state.entities.cols.hp[rowOf(state.entities, 10)]).toBe(0);
  });
});
