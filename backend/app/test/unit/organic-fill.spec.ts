import { describe, expect, it } from 'vitest';
import { isOrganicFill, type OrganicParty } from '../../src/market/settlement/organic.js';

const p = (actorKind: string, colonyId: string, ownerId: string | null): OrganicParty => ({ actorKind, colonyId, ownerId });

describe('isOrganicFill truth table', () => {
  const rows: Array<[string, OrganicParty, OrganicParty, boolean]> = [
    ['player vs player, different colonies and owners', p('player', 'c1', 'o1'), p('player', 'c2', 'o2'), true],
    ['bot vs player', p('bot', 'c1', 'o1'), p('player', 'c2', 'o2'), true],
    ['bot vs bot of different owners', p('bot', 'c1', 'o1'), p('bot', 'c2', 'o2'), true],
    ['unknown owner on one side counts as different', p('player', 'c1', null), p('bot', 'c2', 'o2'), true],
    ['unknown owner on both sides counts as different', p('player', 'c1', null), p('player', 'c2', null), true],
    ['empty-string owner counts as unknown', p('player', 'c1', ''), p('player', 'c2', ''), true],
    ['same owner, different colonies (player/player)', p('player', 'c1', 'o1'), p('player', 'c2', 'o1'), false],
    ['same owner, bot and player', p('bot', 'c1', 'o1'), p('player', 'c2', 'o1'), false],
    ['same owner, two bots', p('bot', 'c1', 'o1'), p('bot', 'c2', 'o1'), false],
    ['same colony, different owners', p('player', 'c1', 'o1'), p('bot', 'c1', 'o2'), false],
    ['fixture side', p('fixture', 'c1', 'o1'), p('player', 'c2', 'o2'), false],
    ['subsidy side', p('player', 'c1', 'o1'), p('subsidy', 'c2', 'o2'), false],
    ['npc side', p('npc', 'c1', null), p('bot', 'c2', 'o2'), false],
    ['guild side', p('bot', 'c1', 'o1'), p('guild', 'c2', null), false],
    ['unknown kind', p('wizard', 'c1', 'o1'), p('player', 'c2', 'o2'), false],
  ];
  it.each(rows)('%s -> %s', (_n, a, b, want) => {
    expect(isOrganicFill(a, b)).toBe(want);
    expect(isOrganicFill(b, a)).toBe(want); // symmetric
  });
});
