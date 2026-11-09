import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import { createPlanet, SimHost, type SimCommand } from '../../src';
import { ENTITY_KIND, ENTITY_STATE } from '../../src/ecs/columns';
import { placeSpawnedEntity } from '../../src/ecs/placement';
import { insertRow } from '../../src/ecs/store';
import { awayPolicyRejectionCount, resetAwayPolicyRejections } from '../../src/systems/away/gate';
import { openAwaySession } from '../../src/systems/away/session';

const COLONY = 'co_01ARZ3NDEKTSV4RRFFQ69G5FAV';

function solar(sim: SimHost): number {
  const id = sim.state.meta.nextEntityId++;
  const row = insertRow(sim.state.entities, id, sim.tick);
  const cols = sim.state.entities.cols;
  cols.kind[row] = ENTITY_KIND.solar;
  cols.owner[row] = 0;
  cols.hp[row] = 400;
  cols.hpMax[row] = 400;
  cols.state[row] = ENTITY_STATE.active;
  placeSpawnedEntity(sim.state.entities, row, 2, 0, sim.tick);
  return id;
}

function boot(): SimHost {
  resetAwayPolicyRejections();
  const sim = new SimHost({ flags: parseWaves('..09') });
  sim.load(createPlanet({ type: 'flat', seed: 'w09-gate', radius: 6 }));
  sim.submit({ colonyIndex: 0, source: 'player', commandId: 'cm_set', kind: 'setAutopilot', args: { mode: 'director' } });
  sim.step(1);
  openAwaySession(sim.state, 0, COLONY, { metals: 100, minerals: 100, bio: 100 }, sim.tick);
  return sim;
}

function demolish(id: number, source: SimCommand['source'], commandId: string): SimCommand {
  return { colonyIndex: 0, source, commandId, kind: 'demolish', args: { entityId: id } };
}

describe('W09-12 away policy gate', () => {
  it('accepts a player demolish while away and rejects an AI demolish', () => {
    const sim = boot();
    const id = solar(sim);
    sim.submit(demolish(id, 'player', 'cm_player'));
    const player = sim.step(1).outcomes[0];
    expect(player?.code).toBeUndefined();
    sim.submit(demolish(id, 'ai', 'cm_ai'));
    const ai = sim.step(1).outcomes[0];
    expect(ai?.code).toBe('away_policy');
    expect(ai?.detail).toBe('AW-10');
    expect(awayPolicyRejectionCount('AW-10')).toBe(1);
  });

  it('does not count a second look at a command that is not away, and counts a repeat', () => {
    const sim = boot();
    sim.submit(demolish(99, 'ai', 'cm_ai_1'));
    sim.submit(demolish(99, 'ai', 'cm_ai_2'));
    sim.step(1);
    expect(awayPolicyRejectionCount()).toBe(2);
    expect(awayPolicyRejectionCount('AW-10')).toBe(2);
  });

  it('lets a player command through when the session is closed', () => {
    resetAwayPolicyRejections();
    const sim = new SimHost({ flags: parseWaves('..09') });
    sim.load(createPlanet({ type: 'flat', seed: 'w09-present', radius: 4 }));
    sim.submit(demolish(1, 'ai', 'cm_here'));
    const outcome = sim.step(1).outcomes[0];
    expect(outcome?.code).not.toBe('away_policy');
    expect(awayPolicyRejectionCount()).toBe(0);
  });
});
