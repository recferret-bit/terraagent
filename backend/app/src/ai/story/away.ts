import { GlobalTokenBudget } from '../budget/global.js';

const STORY_CAP = 600;

export interface AwayStoryInput {
  readonly enabled: boolean;
  readonly day: string;
  readonly colonyId: string;
  readonly facts: readonly string[];
}

export interface AwayStoryResult {
  readonly paragraph: string | null;
  readonly commands: readonly never[];
}

/**
 * Narrative only (AI §6, §7). A failure or a disabled flag omits the paragraph.
 * The result cannot carry actions. Token reserve uses the shared global budget.
 */
export function awayStory(input: AwayStoryInput, budget: GlobalTokenBudget, reserveTokens = 200): AwayStoryResult {
  if (!input.enabled) return { paragraph: null, commands: [] };
  const reserved = budget.reserve(input.day, reserveTokens);
  if (!reserved.ok) return { paragraph: null, commands: [] };
  const text = input.facts.join(' ').replace(/\s+/g, ' ').trim().slice(0, STORY_CAP);
  if (!text) {
    budget.reconcile(input.day, reserveTokens, 0);
    return { paragraph: null, commands: [] };
  }
  budget.reconcile(input.day, reserveTokens, Math.min(reserveTokens, text.length));
  return { paragraph: text, commands: [] };
}
