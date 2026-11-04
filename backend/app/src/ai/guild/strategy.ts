import { GlobalTokenBudget } from '../budget/global.js';

export interface GuildStrategyInput {
  readonly npcColonyId: string;
  readonly targetColonyId: string;
  readonly day: string;
}

export interface GuildStrategyResult {
  readonly ok: boolean;
  readonly outcome: 'ok' | 'unauthorized' | 'budget_exhausted';
  readonly readColonyIds: readonly string[];
  readonly commands: readonly never[];
}

/**
 * Guild NPC principal (AI §6). It may reserve the shared global budget for its own colony.
 * It cannot read or command a different player colony.
 */
export function guildStrategy(input: GuildStrategyInput, budget: GlobalTokenBudget, tokens = 100): GuildStrategyResult {
  if (input.targetColonyId !== input.npcColonyId) {
    return { ok: false, outcome: 'unauthorized', readColonyIds: [], commands: [] };
  }
  const reserved = budget.reserve(input.day, tokens);
  if (!reserved.ok) return { ok: false, outcome: 'budget_exhausted', readColonyIds: [], commands: [] };
  budget.reconcile(input.day, tokens, tokens);
  return { ok: true, outcome: 'ok', readColonyIds: [input.npcColonyId], commands: [] };
}
