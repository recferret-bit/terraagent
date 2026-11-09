import { describe, expect, it } from 'vitest';
import { GlobalTokenBudget } from '../../src/ai/budget/global.js';
import { awayStory } from '../../src/ai/story/away.js';

describe('W16-20 away story', () => {
  it('returns a bounded paragraph and no commands', () => {
    const budget = new GlobalTokenBudget(10_000);
    const result = awayStory({
      enabled: true,
      day: '2026-11-04',
      colonyId: 'co_1',
      facts: ['The night was quiet.', 'Metals held.'],
    }, budget);
    expect(result.paragraph).toBe('The night was quiet. Metals held.');
    expect(result.paragraph!.length).toBeLessThanOrEqual(600);
    expect(result.commands).toEqual([]);
  });

  it('omits the paragraph when disabled or the shared budget is exhausted', () => {
    const off = awayStory({ enabled: false, day: '2026-11-04', colonyId: 'co_1', facts: ['x'] }, new GlobalTokenBudget(10_000));
    expect(off).toEqual({ paragraph: null, commands: [] });
    const broke = awayStory({ enabled: true, day: '2026-11-04', colonyId: 'co_1', facts: ['x'] }, new GlobalTokenBudget(10), 200);
    expect(broke).toEqual({ paragraph: null, commands: [] });
  });
});
