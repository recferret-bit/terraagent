import { describe, expect, it } from 'vitest';
import { GlobalTokenBudget } from '../../src/ai/budget/global.js';
import { guildStrategy } from '../../src/ai/guild/strategy.js';

describe('W16-21 guild strategy', () => {
  it('refuses to read or command a different player colony', () => {
    const budget = new GlobalTokenBudget(10_000);
    const result = guildStrategy({ npcColonyId: 'co_npc', targetColonyId: 'co_player', day: '2026-11-04' }, budget);
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe('unauthorized');
    expect(result.readColonyIds).toEqual([]);
    expect(result.commands).toEqual([]);
  });

  it('may spend the shared budget only on the NPC colony and still submits no commands', () => {
    const budget = new GlobalTokenBudget(10_000);
    const result = guildStrategy({ npcColonyId: 'co_npc', targetColonyId: 'co_npc', day: '2026-11-04' }, budget);
    expect(result.outcome).toBe('ok');
    expect(result.readColonyIds).toEqual(['co_npc']);
    expect(result.commands).toEqual([]);
    expect(result.strategy?.specialisation).toBe('balanced');
    expect(result.strategy?.route).toBe('guild_hub');
  });

  it('rejects a free price in NPC strategy output with free_price_forbidden and spends zero tokens', () => {
    const budget = new GlobalTokenBudget(100);
    const rejected = guildStrategy(
      {
        npcColonyId: 'co_npc',
        targetColonyId: 'co_npc',
        day: '2026-11-04',
        proposal: {
          specialisation: 'miner',
          risk: 'conservative',
          goals: ['surplus_export'],
          reserveTargets: {},
          price: 999,
        },
      },
      budget,
      100,
    );
    expect(rejected.ok).toBe(false);
    expect(rejected.outcome).toBe('invalid');
    expect(rejected.reason).toBe('free_price_forbidden');
    expect(rejected.commands).toEqual([]);
    // Budget remains untouched because invalid strategy is rejected before reservation
    expect(budget.reserve('2026-11-04', 100).ok).toBe(true);
  });
});
