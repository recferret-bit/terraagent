import { parseWaves, RESOURCE_KEYS, type AwayDigestV1 } from '@terra/contracts';
import { GlobalTokenBudget } from '../../ai/budget/global';
import { awayStory, keepNarrative, type AwayStoryInput, type AwayStoryResult } from '../../ai/story/away';

/** One paragraph for a closed digest. Commands from the teller are not part of this slot. */
export interface DigestStory {
  paragraph(colonyId: string, at: Date, facts: readonly string[]): string | null;
}

/**
 * CT-34. Unset is on in production and off elsewhere. Only the exact string `true` forces on.
 * `false` and any other non-empty value force off (the env schema rejects those others at boot).
 */
export function awayStoryEnabled(env: { readonly NODE_ENV?: unknown; readonly AWAY_STORY_ENABLED?: unknown }): boolean {
  const raw = env.AWAY_STORY_ENABLED;
  if (raw === undefined || raw === '') return env.NODE_ENV === 'production';
  return raw === 'true';
}

/** W16 off leaves the slot empty. Otherwise the slot calls `awayStory` (no network). */
export function createDigestStory(env: {
  readonly NODE_ENV?: unknown;
  readonly AWAY_STORY_ENABLED?: unknown;
  readonly TA_WAVES?: unknown;
}): DigestStory | undefined {
  const spec = typeof env.TA_WAVES === 'string' ? env.TA_WAVES : undefined;
  if (!parseWaves(spec).has('W16')) return undefined;
  const enabled = awayStoryEnabled(env);
  let inner: DigestStory | undefined;
  return {
    paragraph(colonyId, at, facts) {
      inner ??= digestStoryProvider(enabled, new GlobalTokenBudget());
      return inner.paragraph(colonyId, at, facts);
    },
  };
}

/** `tell` defaults to `awayStory`. A returned command list is ignored. */
export function digestStoryProvider(
  enabled: boolean,
  budget: GlobalTokenBudget,
  tell: (input: AwayStoryInput, budget: GlobalTokenBudget) => AwayStoryResult = awayStory,
): DigestStory {
  return {
    paragraph(colonyId, at, facts) {
      const told = tell({ enabled, day: utcDay(at), colonyId, facts }, budget);
      return keepNarrative(told.paragraph);
    },
  };
}

/** Duration, attack counts, and the first non-zero resource net. Zeros are left out so an empty close has no facts. */
export function awayFacts(body: AwayDigestV1): string[] {
  const facts: string[] = [];
  if (body.durationS > 0) facts.push(`Away for ${body.durationS}s.`);
  if (body.attacks.count > 0 || body.attacks.repelled > 0) {
    facts.push(`${body.attacks.count} attacks, ${body.attacks.repelled} repelled.`);
  }
  const net = firstNet(body);
  if (net) facts.push(net);
  return facts;
}

/** Same object when there is nothing to say, so a disabled provider does not add a `story` key. */
export function withAwayParagraph(body: AwayDigestV1, paragraph: string | null): AwayDigestV1 {
  const kept = keepNarrative(paragraph);
  if (!kept) {
    if (body.story === undefined) return body;
    const rest = { ...body };
    delete rest.story;
    return rest;
  }
  return { ...body, story: kept };
}

function firstNet(body: AwayDigestV1): string | null {
  for (const key of RESOURCE_KEYS) {
    const delta = body.resources[key].after - body.resources[key].before;
    if (delta !== 0) return `${key} net ${delta}.`;
  }
  return null;
}

function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}
