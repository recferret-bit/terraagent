import { AI_INPUT_TOKEN_CAP, AI_MAX_TOOL_CALLS, AI_MAX_TURNS } from '@terra/contracts';

export type LoopStop = 'ok' | 'turn_cap' | 'tool_cap' | 'token_cap';

export interface LoopUse {
  readonly turns: number;
  readonly toolCalls: number;
  readonly tokens: number;
}

/** Stops the planning loop at the contract caps (AI §6). Caps are not raised for a risky profile. */
export function planningStep(use: LoopUse): LoopStop {
  if (use.turns > AI_MAX_TURNS) return 'turn_cap';
  if (use.toolCalls > AI_MAX_TOOL_CALLS) return 'tool_cap';
  if (use.tokens > AI_INPUT_TOKEN_CAP) return 'token_cap';
  return 'ok';
}

export const LOOP_CAPS = { turns: AI_MAX_TURNS, tools: AI_MAX_TOOL_CALLS, tokens: AI_INPUT_TOKEN_CAP };
