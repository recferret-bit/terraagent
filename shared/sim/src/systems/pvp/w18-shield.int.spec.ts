import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  createPlanet,
  ensureColonyRecord,
  ENTITY_KIND,
  ENTITY_STATE,
  hexIndex,
  insertRow,
  SimHost,
} from '../../index';
import { isColonyRaidProtected, TICKS_PER_HOUR } from './index';

describe('W18-06 SimHost integration — newcomer shield raid_protected & offensive shield drop', () => {
  it('Raid a 1h S3 colony -> rejected raid_protected; that colony raids someone -> its shield ends', () => {
    const sim = new SimHost({ flags: parseWaves('..18') });
    sim.load(createPlanet({ type: 'flat', seed: 'w18-06-int', radius: 24 }));

    // Colony 0: S4 attacker (unshielded)
    const col0 = ensureColonyRecord(sim.state, 0, 0);
    col0.status = 'active';
    col0.stage = 4;

    // Colony 1: S3 newcomer (shielded for 6h)
    const col1 = ensureColonyRecord(sim.state, 1, 0);
    col1.status = 'active';
    col1.stage = 3;

    // Colony 2: S4 rival (unshielded)
    const col2 = ensureColonyRecord(sim.state, 2, 0);
    col2.status = 'active';
    col2.stage = 4;

    // Spawn a recon for Colony 0 and claim a tile for Colony 1
    const reconId = sim.state.meta.nextEntityId++;
    const rRow = insertRow(sim.state.entities, reconId, 0);
    sim.state.entities.cols.kind[rRow] = ENTITY_KIND.recon;
    sim.state.entities.cols.owner[rRow] = 0;
    sim.state.entities.cols.hp[rRow] = 80;
    sim.state.entities.cols.hpMax[rRow] = 80;
    sim.state.entities.cols.state[rRow] = ENTITY_STATE.idle;
    sim.state.entities.cols.q[rRow] = 0;
    sim.state.entities.cols.r[rRow] = 0;

    const col1Tile = hexIndex(sim.state.grid.radius).indexOf(5, 0);
    sim.state.grid.layers.owner[col1Tile] = 1;

    // Advance clock to 1 hour (18,000 ticks)
    sim.state.meta.tick = TICKS_PER_HOUR;
    sim.step(1);

    expect(isColonyRaidProtected(sim.state, 1, sim.tick)).toBe(true);
    expect(isColonyRaidProtected(sim.state, 0, sim.tick)).toBe(false);

    // Colony 0 attempts to raid Colony 1 -> rejected raid_protected
    sim.submit({
      colonyIndex: 0,
      source: 'player',
      commandId: 'cmd_raid_c1',
      kind: 'raid',
      args: { targetColonyId: 'col_1' },
    });
    expect(sim.step(1).outcomes[0]?.code).toBe('raid_protected');

    // Colony 0 attempts enqueueTask(raid) on Colony 1 -> rejected raid_protected
    sim.submit({
      colonyIndex: 0,
      source: 'player',
      commandId: 'cmd_enq_raid_c1',
      kind: 'enqueueTask',
      args: { raid: { targetColonyId: 'col_1' } },
    });
    expect(sim.step(1).outcomes[0]?.code).toBe('raid_protected');

    // Colony 0 attempts attackMove into Colony 1's claimed tile -> rejected raid_protected
    sim.submit({
      colonyIndex: 0,
      source: 'player',
      commandId: 'cmd_am_c1',
      kind: 'attackMove',
      args: { entityId: reconId, q: 5, r: 0 },
    });
    expect(sim.step(1).outcomes[0]?.code).toBe('raid_protected');

    // Now Colony 1 raids Colony 2 -> Colony 1's newcomer shield drops immediately!
    sim.submit({
      colonyIndex: 1,
      source: 'player',
      commandId: 'cmd_c1_raids_c2',
      kind: 'raid',
      args: { targetColonyId: 'col_2' },
    });
    expect(sim.step(1).outcomes[0]?.code).toBeUndefined();
    expect(isColonyRaidProtected(sim.state, 1, sim.tick)).toBe(false);
    expect(sim.state.colonies[1]?.raidProtectedUntil).toBe(0);

    // Now Colony 0 can raid Colony 1!
    sim.submit({
      colonyIndex: 0,
      source: 'player',
      commandId: 'cmd_raid_c1_after_drop',
      kind: 'raid',
      args: { targetColonyId: 'col_1' },
    });
    expect(sim.step(1).outcomes[0]?.code).toBeUndefined();
  });
});

describe('W18-06 SimHost integration — dev.setShield command', () => {
  it('dev.setShield sets and clears newcomer shield hours via SimHost', () => {
    const sim = new SimHost({ flags: parseWaves('..18') });
    sim.load(createPlanet({ type: 'flat', seed: 'w18-06-dev', radius: 20 }));
    const col0 = ensureColonyRecord(sim.state, 0, 0);
    col0.status = 'active';
    col0.stage = 4;
    const col1 = ensureColonyRecord(sim.state, 1, 0);
    col1.status = 'active';
    col1.stage = 4;

    sim.submit({
      colonyIndex: 1,
      source: 'dev',
      commandId: 'cmd_set_shield_5',
      kind: 'dev.setShield',
      args: { hours: 5, colonyIndex: 1 },
    });
    expect(sim.step(1).outcomes[0]?.code).toBeUndefined();
    expect(isColonyRaidProtected(sim.state, 1, sim.tick)).toBe(true);

    sim.submit({
      colonyIndex: 0,
      source: 'player',
      commandId: 'cmd_raid_shielded',
      kind: 'raid',
      args: { targetColonyId: 'col_1' },
    });
    expect(sim.step(1).outcomes[0]?.code).toBe('raid_protected');

    sim.submit({
      colonyIndex: 1,
      source: 'dev',
      commandId: 'cmd_set_shield_0',
      kind: 'dev.setShield',
      args: { hours: 0, colonyIndex: 1 },
    });
    expect(sim.step(1).outcomes[0]?.code).toBeUndefined();
    expect(isColonyRaidProtected(sim.state, 1, sim.tick)).toBe(false);
  });
});
