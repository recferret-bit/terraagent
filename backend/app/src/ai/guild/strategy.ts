import {
  validateAgentStrategy,
  type AgentStrategyInput,
  type StrategyValidationErrorCode,
} from '@terra/sim';
import { GlobalTokenBudget } from '../budget/global.js';

export interface GuildStrategyInput {
  readonly npcColonyId: string;
  readonly targetColonyId: string;
  readonly day: string;
  readonly route?: string;
  readonly proposal?: unknown;
}

export interface GuildStrategyResult {
  readonly ok: boolean;
  readonly outcome: 'ok' | 'unauthorized' | 'budget_exhausted' | 'invalid';
  readonly reason?: StrategyValidationErrorCode;
  readonly strategy?: AgentStrategyInput & { readonly route: string };
  readonly readColonyIds: readonly string[];
  readonly commands: readonly never[];
}

const DEFAULT_GUILD_PROPOSAL = {
  specialisation: 'balanced',
  risk: 'conservative',
  goals: ['surplus_export', 'reserve_build'],
  reserveTargets: {
    'metals.t1': { reserve: '50', target: '120', keep: '50' },
  },
} as const;

/**
 * Guild NPC principal (AI §6, W16-21). It may reserve the shared global budget for its own colony.
 * Output is strategy only (route, stockpile goals, specialisation, reserve targets, risk) consumed by
 * the W15 agent on the W13 bot API and quote library; any free price is rejected with `free_price_forbidden`.
 * It cannot read or command a different player colony.
 */
export function guildStrategy(input: GuildStrategyInput, budget: GlobalTokenBudget, tokens = 100): GuildStrategyResult {
  if (input.targetColonyId !== input.npcColonyId) {
    return { ok: false, outcome: 'unauthorized', readColonyIds: [], commands: [] };
  }
  const validated = validateAgentStrategy(input.proposal ?? DEFAULT_GUILD_PROPOSAL);
  if (!validated.ok) {
    return {
      ok: false,
      outcome: 'invalid',
      reason: validated.code,
      readColonyIds: [],
      commands: [],
    };
  }
  const reserved = budget.reserve(input.day, tokens);
  if (!reserved.ok) return { ok: false, outcome: 'budget_exhausted', readColonyIds: [], commands: [] };
  budget.reconcile(input.day, tokens, tokens);
  return {
    ok: true,
    outcome: 'ok',
    strategy: { ...validated.value, route: input.route ?? 'guild_hub' },
    readColonyIds: [input.npcColonyId],
    commands: [],
  };
}
