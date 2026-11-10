import { GlobalTokenBudget } from '../budget/global.js';

const STORY_CAP = 600;

/** An opening order is not a story. The rest of the paragraph is not rewritten. */
const IMPERATIVE = /^\s*(build|attack|buy|sell|move|destroy)\b/i;

/** Null when there is no paragraph, or it opens as an order. Longer text is cut to the cap. */
export function keepNarrative(paragraph: string | null): string | null {
  if (!paragraph) return null;
  const text = paragraph.slice(0, STORY_CAP);
  if (!text.trim() || IMPERATIVE.test(text)) return null;
  return text;
}

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
 * Narrative only (AI §6, §7). Disabled, over budget, empty, or an opening order omits the paragraph.
 * The result cannot carry actions. An omitted paragraph reconciles its reserve to 0.
 */
export function awayStory(input: AwayStoryInput, budget: GlobalTokenBudget, reserveTokens = 200): AwayStoryResult {
  if (!input.enabled) return { paragraph: null, commands: [] };
  const reserved = budget.reserve(input.day, reserveTokens);
  if (!reserved.ok) return { paragraph: null, commands: [] };
  const text = input.facts.join(' ').replace(/\s+/g, ' ').trim().slice(0, STORY_CAP);
  const paragraph = keepNarrative(text);
  if (!paragraph) {
    budget.reconcile(input.day, reserveTokens, 0);
    return { paragraph: null, commands: [] };
  }
  budget.reconcile(input.day, reserveTokens, Math.min(reserveTokens, paragraph.length));
  return { paragraph, commands: [] };
}
