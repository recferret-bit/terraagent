import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  createRegistryPipeline, createState, ensureColonyLedger, ensureColonyRecord, getAllQueueEntries, getColonyQueue,
  isColonyAiEnabled, SimHost, spawnHqUnit, step,
} from '../../src';

function s0Planet() {
  const state = createState({ planetId: 'ai-toggle', planetType: 'temperate', seed: 'ai-toggle', radius: 10 });
  const colony = ensureColonyLedger(ensureColonyRecord(state, 0, 0));
  colony.status = 'active';
  colony.stock['metals.t1'] = 600;
  colony.stock['minerals.t1'] = 350;
  spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
  return { state, pipeline: createRegistryPipeline({ flags: parseWaves('..08') }) };
}

const queueGoal = { commandId: 'g1', colonyIndex: 0, source: 'player', kind: 'queueGoal', args: { goal: 'establish_colony' } } as const;

describe('colony AI switch (default off)', () => {
  it('is off by default and bots queue nothing on their own, even with a goal queued', () => {
    const { state, pipeline } = s0Planet();
    expect(isColonyAiEnabled(state, 0)).toBe(false);
    step(state, [queueGoal], 1, pipeline);
    step(state, [], 60, pipeline);
    expect(getAllQueueEntries(state).filter((e) => e.precedence === 'hq' || e.precedence === 'ai')).toHaveLength(0);
    expect(getColonyQueue(state, 0, 'construction')).toHaveLength(0);
  });

  it('setAiEnabled turns goal breakdown on and off, and the view reports it', () => {
    const { state, pipeline } = s0Planet();
    const host = new SimHost(pipeline);
    host.load(state);
    expect(host.view().colonies[0].aiEnabled).toBe(false);
    host.submit(queueGoal);
    host.submit({ commandId: 'ai-on', colonyIndex: 0, source: 'player', kind: 'setAiEnabled', args: { enabled: true } });
    host.step(2);
    expect(isColonyAiEnabled(host.state, 0)).toBe(true);
    expect(host.view().colonies[0].aiEnabled).toBe(true);
    expect(getAllQueueEntries(host.state).some((e) => e.precedence === 'hq')).toBe(true);
    host.submit({ commandId: 'ai-off', colonyIndex: 0, source: 'player', kind: 'setAiEnabled', args: { enabled: false } });
    host.step(1);
    expect(isColonyAiEnabled(host.state, 0)).toBe(false);
    expect(host.view().colonies[0].aiEnabled).toBe(false);
  });

  it('rejects malformed args', () => {
    const { state, pipeline } = s0Planet();
    const res = step(state, [{ commandId: 'bad', colonyIndex: 0, source: 'player', kind: 'setAiEnabled', args: { enabled: 'yes' } }], 1, pipeline);
    expect(res.outcomes[0].code).toBe('invalid_args');
  });
});
