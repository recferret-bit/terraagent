import { describe, expect, it } from 'vitest';
import { parseWaves, W11_DEFAULT_SECTOR_RADIUS } from '@terra/contracts';
import {
  createPlanet,
  ensureColonyRecord,
  ENTITY_KIND,
  ENTITY_STATE,
  hexIndex,
  insertRow,
  SimHost,
} from '../../index';

function bootSectorGuardSim(): { sim: SimHost; reconId: number; target2Id: number } {
  const sim = new SimHost({ flags: parseWaves('..18') });
  sim.load(
    createPlanet({
      type: 'flat',
      seed: 'w18-31-int',
      radius: W11_DEFAULT_SECTOR_RADIUS,
    }),
  );

  const col0 = ensureColonyRecord(sim.state, 0, 0);
  col0.status = 'active';
  col0.stage = 4;
  col0.foundingSectorId = 'sec_0_0';

  const col1 = ensureColonyRecord(sim.state, 1, 0);
  col1.status = 'active';
  col1.stage = 4;
  col1.foundingSectorId = 'sec_0_0';

  const col2 = ensureColonyRecord(sim.state, 2, 0);
  col2.status = 'active';
  col2.stage = 4;
  col2.foundingSectorId = 'sec_1_0';

  const reconId = sim.state.meta.nextEntityId++;
  const r0 = insertRow(sim.state.entities, reconId, 0);
  sim.state.entities.cols.kind[r0] = ENTITY_KIND.recon;
  sim.state.entities.cols.owner[r0] = 0;
  sim.state.entities.cols.hp[r0] = 80;
  sim.state.entities.cols.hpMax[r0] = 80;
  sim.state.entities.cols.state[r0] = ENTITY_STATE.idle;
  sim.state.entities.cols.q[r0] = 0;
  sim.state.entities.cols.r[r0] = 0;

  const target2Id = sim.state.meta.nextEntityId++;
  const r2 = insertRow(sim.state.entities, target2Id, 0);
  sim.state.entities.cols.kind[r2] = ENTITY_KIND.recon;
  sim.state.entities.cols.owner[r2] = 2;
  sim.state.entities.cols.hp[r2] = 80;
  sim.state.entities.cols.hpMax[r2] = 80;
  sim.state.entities.cols.state[r2] = ENTITY_STATE.idle;
  sim.state.entities.cols.q[r2] = 12;
  sim.state.entities.cols.r[r2] = 0;

  const tile2Idx = hexIndex(sim.state.grid.radius).indexOf(12, 0);
  sim.state.grid.layers.owner[tile2Idx] = 2;
  return { sim, reconId, target2Id };
}

describe('W18-31 SimHost integration — R=48 founding sector & cross_sector_disabled guard', () => {
  it('allows raids within sec_0_0 and rejects cross-sector raid, enqueueTask(raid), attackMove & attackTarget with cross_sector_disabled', () => {
    const { sim, reconId, target2Id } = bootSectorGuardSim();

    sim.submit({
      colonyIndex: 0,
      source: 'player',
      commandId: 'cmd_raid_cross',
      kind: 'raid',
      args: { targetColonyId: 'col_2' },
    });
    expect(sim.step(1).outcomes[0]?.code).toBe('cross_sector_disabled');

    sim.submit({
      colonyIndex: 0,
      source: 'player',
      commandId: 'cmd_enq_raid_cross',
      kind: 'enqueueTask',
      args: { raid: { targetColonyId: 'col_2' } },
    });
    expect(sim.step(1).outcomes[0]?.code).toBe('cross_sector_disabled');

    sim.submit({
      colonyIndex: 0,
      source: 'player',
      commandId: 'cmd_am_cross',
      kind: 'attackMove',
      args: { entityId: reconId, q: 12, r: 0 },
    });
    expect(sim.step(1).outcomes[0]?.code).toBe('cross_sector_disabled');

    sim.submit({
      colonyIndex: 0,
      source: 'player',
      commandId: 'cmd_at_cross',
      kind: 'attackTarget',
      args: { entityId: reconId, targetId: target2Id },
    });
    expect(sim.step(1).outcomes[0]?.code).toBe('cross_sector_disabled');

    sim.submit({
      colonyIndex: 0,
      source: 'player',
      commandId: 'cmd_raid_same_sector',
      kind: 'raid',
      args: { targetColonyId: 'col_1' },
    });
    expect(sim.step(1).outcomes[0]?.code).toBeUndefined();
  });
});
