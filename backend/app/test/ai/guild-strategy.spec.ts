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
  });
});
