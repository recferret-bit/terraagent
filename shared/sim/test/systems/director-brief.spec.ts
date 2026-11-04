import { describe, expect, it } from 'vitest';
import { AI_BRIEF_MAX_BYTES, parseWaves } from '@terra/contracts';
import { createPlanet, SimHost, type SimCommand } from '../../src';
import { buildColonyBrief, guardBriefText } from '../../src/systems/director';
import { saveQueueEntries, type QueueEntry } from '../../src/systems/queue';

function host(radius = 8): SimHost {
  const sim = new SimHost({ flags: parseWaves('..16') });
  sim.load(createPlanet({ type: 'flat', seed: 'w16-brief', radius }));
  return sim;
}

let seq = 0;
function cmd(kind: string, args: unknown): SimCommand {
  return { colonyIndex: 0, source: 'player', commandId: `b${++seq}`, kind, args };
}

function playerOrder(tick: number): QueueEntry {
  return {
    taskId: 'order_player_1',
    colonyIndex: 0,
    lane: 'terraform',
    precedence: 'player',
    state: 'queued',
    task: { kind: 'terraform', op: 'clear', q: 1, r: 1 },
    cost: {},
    paid: false,
    progress: 0,
    buildTicks: 1,
    elapsedTicks: 0,
    workRate: 1,
    createdAt: tick,
  };
}

describe('W16-06 colony brief', () => {
  it('includes the current goal and the player order and stays inside the byte cap', () => {
    const sim = host();
    sim.submit(cmd('queueGoal', { goal: 'establish_colony' }));
    sim.step(1);
    saveQueueEntries(sim.state, [playerOrder(sim.tick)], sim.tick);
    const built = buildColonyBrief(sim.state, 0, { flags: parseWaves('..16').list });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.brief.goals.some((goal) => goal.goal === 'establish_colony')).toBe(true);
    expect(built.brief.manualOrders).toEqual([{ id: 'order_player_1', kind: 'terraform' }]);
    expect(built.bytes).toBeLessThanOrEqual(AI_BRIEF_MAX_BYTES);
    expect(built.brief.policy.priorities.economy).toBe(50);
  });

  it('does not grow sectors with the planet radius', () => {
    const small = host(8);
    const large = host(48);
    small.step(1);
    large.step(1);
    const a = buildColonyBrief(small.state, 0, { flags: ['W00', 'W16'] });
    const b = buildColonyBrief(large.state, 0, { flags: ['W00', 'W16'] });
    expect(large.state.grid.count).toBeGreaterThan(small.state.grid.count);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.brief.sectors).toEqual([]);
    expect(b.brief.sectors).toEqual([]);
    expect(b.brief.capabilities.w11).toBe(false);
  });

  it('rejects an oversized serialisation before it would be sent', () => {
    expect(guardBriefText('x'.repeat(AI_BRIEF_MAX_BYTES + 1))).toBe('context_too_large');
    expect(guardBriefText('{"version":2}')).toBe('ok');
  });
});
