import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  createPlanet,
  ensureColonyRecord,
  ENTITY_KIND,
  ENTITY_STATE,
  getUnitGroupId,
  hexDistance,
  insertRow,
  rowOf,
  SimHost,
  type PlanetState,
  type SimCommand,
} from '../../index';

let cmdSeq = 1;
function makeCmd(
  kind: string,
  colonyIndex: number,
  args: Record<string, unknown>,
  source: SimCommand['source'] = 'player',
): SimCommand {
  return {
    commandId: `cmd_w18_raid_${cmdSeq++}`,
    kind,
    colonyIndex,
    source,
    args,
  };
}

function addEntity(
  state: PlanetState,
  spec: { kind: number; owner: number; q: number; r: number; hp: number; state: number },
): number {
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, 0);
  state.entities.cols.kind[row] = spec.kind;
  state.entities.cols.owner[row] = spec.owner;
  state.entities.cols.q[row] = spec.q;
  state.entities.cols.r[row] = spec.r;
  state.entities.cols.x[row] = spec.q;
  state.entities.cols.y[row] = spec.r;
  state.entities.cols.hp[row] = spec.hp;
  state.entities.cols.hpMax[row] = spec.hp;
  state.entities.cols.state[row] = spec.state;
  return id;
}

function bootRaidSim(flags = '..18') {
  const sim = new SimHost({ flags: parseWaves(flags) });
  sim.load(createPlanet({ type: 'flat', seed: 'w18-raid-int-seed', radius: 32 }));
  const state = sim.state;

  const col0 = ensureColonyRecord(state, 0, 0);
  col0.id = 'col_0';
  col0.status = 'active';
  col0.stage = 4;
  col0.sectorId = 0;

  const col1 = ensureColonyRecord(state, 1, 0);
  col1.id = 'col_1';
  col1.status = 'active';
  col1.stage = 4;
  col1.sectorId = 0;

  addEntity(state, { kind: ENTITY_KIND.commandHub, owner: 0, q: 0, r: 0, hp: 1500, state: ENTITY_STATE.active });
  addEntity(state, { kind: ENTITY_KIND.hq, owner: 0, q: 1, r: 0, hp: 900, state: ENTITY_STATE.idle });
  const recon1 = addEntity(state, { kind: ENTITY_KIND.recon, owner: 0, q: 2, r: 0, hp: 220, state: ENTITY_STATE.idle });
  const recon2 = addEntity(state, { kind: ENTITY_KIND.recon, owner: 0, q: 2, r: 1, hp: 220, state: ENTITY_STATE.idle });

  addEntity(state, { kind: ENTITY_KIND.commandHub, owner: 1, q: 12, r: 0, hp: 1500, state: ENTITY_STATE.active });
  addEntity(state, { kind: ENTITY_KIND.hq, owner: 1, q: 13, r: 0, hp: 900, state: ENTITY_STATE.idle });

  return { sim, state, recon1, recon2 };
}

describe('W18-02 · SimHost raid task integration (enqueueTask, raid, queueGoal)', () => {
  it('enqueues a raid on Colony B → all idle combat units of A get a group ID and advance toward B', () => {
    const { sim, state, recon1, recon2 } = bootRaidSim('..18');
    sim.step(1);

    sim.submit(
      makeCmd('enqueueTask', 0, {
        task: { kind: 'raid', targetColonyIndex: 1 },
      }),
    );
    const res = sim.step(1);
    expect(res.outcomes[0]?.code).toBeUndefined();

    const raidEvent = res.events.find((e) => e.kind === 'raidStarted');
    expect(raidEvent).toBeDefined();
    expect(raidEvent?.data).toMatchObject({
      attackerColony: 0,
      targetColony: 1,
      count: 2,
    });

    expect(getUnitGroupId(state, recon1)).toBe(1);
    expect(getUnitGroupId(state, recon2)).toBe(1);

    const r1Row = rowOf(state.entities, recon1);
    const startDist = hexDistance(state.entities.cols.q[r1Row]!, state.entities.cols.r[r1Row]!, 12, 0);
    sim.step(15);
    const endDist = hexDistance(state.entities.cols.q[r1Row]!, state.entities.cols.r[r1Row]!, 12, 0);
    expect(endDist).toBeLessThan(startDist);
  });

  it('launches a raid via queueGoal(raid_target) and rejects when target is shielded or wave is disabled', () => {
    const { sim, state, recon1, recon2 } = bootRaidSim('..18');
    sim.step(1);

    sim.submit(
      makeCmd('queueGoal', 0, {
        goal: 'raid_target',
        params: { targetColonyId: 1 },
      }),
    );
    const stepGoal = sim.step(1);
    expect(stepGoal.outcomes[0]?.code).toBeUndefined();
    expect(getUnitGroupId(state, recon1)).toBe(1);
    expect(getUnitGroupId(state, recon2)).toBe(1);

    sim.submit(makeCmd('dev.setShield', 1, { colonyIndex: 1, hours: 4 }, 'dev'));
    sim.step(1);

    sim.submit(makeCmd('raid', 0, { targetColonyIndex: 1 }));
    const stepShielded = sim.step(1);
    expect(stepShielded.outcomes[0]?.code).toBe('raid_protected');

    const w17 = bootRaidSim('..17');
    w17.sim.submit(
      makeCmd('queueGoal', 0, {
        goal: 'raid_target',
        params: { targetColonyId: 1 },
      }),
    );
    const stepW17 = w17.sim.step(1);
    expect(stepW17.outcomes[0]?.code).toBe('wave_disabled');
  });
});
