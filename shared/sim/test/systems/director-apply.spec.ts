import { describe, expect, it } from 'vitest';
import { parseWaves, type DirectiveAction } from '@terra/contracts';
import { createPlanet, SimHost, type SimCommand } from '../../src';
import { applyDirectiveBatch } from '../../src/systems/director';
import { getColonyGoals } from '../../src/systems/goals/store';
import { getColonyPriorities } from '../../src/systems/goals/priorities';

function host(): SimHost {
  const sim = new SimHost({ flags: parseWaves('..16') });
  sim.load(createPlanet({ type: 'flat', seed: 'w16-apply', radius: 8 }));
  return sim;
}

let seq = 0;
function cmd(kind: string, args: unknown): SimCommand {
  return { colonyIndex: 0, source: 'player', commandId: `a${++seq}`, kind, args };
}

const limits = { reserveFloorBp: 4000, commitBp: 1500, openGoalSlots: 2, awayRaids: false };
const stocks = [{ id: 'metals.t1', unearmarked: 1000 }];

describe('W16-13 apply directives through goal handlers', () => {
  it('keeps manual work, applies a legal goal, and reports rejections', () => {
    const sim = host();
    sim.submit(cmd('queueGoal', { goal: 'establish_colony' }));
    sim.step(1);
    const manual = getColonyGoals(sim.state, 0).find((goal) => goal.goal === 'establish_colony');
    expect(manual?.status).toBe('active');

    const cancel: DirectiveAction = { actionId: 'cancel', kind: 'cancelGoal', args: { goalId: manual!.id } };
    const sliders: DirectiveAction = { actionId: 'sliders', kind: 'setPriorities', args: { defense: 0 } };
    const grow: DirectiveAction = {
      actionId: 'grow',
      kind: 'queueGoal',
      args: { goal: 'grow_economy', budgetBp: 1000, params: { resource: 'metals.t1' } },
    };
    const acks = applyDirectiveBatch(sim.state, 0, [cancel, sliders, grow], stocks, limits, sim.tick);

    expect(acks.find((ack) => ack.actionId === 'cancel')).toEqual({ actionId: 'cancel', state: 'rejected', reason: 'locked_goal' });
    expect(acks.find((ack) => ack.actionId === 'sliders')).toEqual({ actionId: 'sliders', state: 'rejected', reason: 'player_baseline' });
    expect(acks.find((ack) => ack.actionId === 'grow')?.state).toBe('applied');
    expect(getColonyGoals(sim.state, 0).some((goal) => goal.id === manual!.id && goal.status === 'active')).toBe(true);
    expect(getColonyPriorities(sim.state, 0).defense).toBe(50);
    const economy = getColonyGoals(sim.state, 0).find((goal) => goal.goal === 'grow_economy');
    expect(economy?.budgetBp).toBe(1000);
    expect(acks.some((ack) => ack.state === 'applied' && ack.actionId === 'cancel')).toBe(false);
  });
});
