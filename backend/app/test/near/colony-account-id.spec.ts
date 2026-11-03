import { colonyAccountId, NearAccountId } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import { colonyAccountCandidates, fitColonyAccountId } from '../../src/near/identity/colony-account-id';

const COLONY = 'co_01ARZ3NDEKTSV4RRFFQ69G5FAV';

describe('fitColonyAccountId', () => {
  it('keeps a short name and lowercases the colony id', () => {
    expect(fitColonyAccountId(COLONY, 'test-pilot')).toBe(colonyAccountId(COLONY, 'test-pilot'));
    expect(fitColonyAccountId(COLONY, 'test-pilot')).toBe('co_01arz3ndektsv4rrffq69g5fav.test-pilot.terraagent.mock');
  });

  it('shortens a 32-character name and keeps the colony segment', () => {
    const id = fitColonyAccountId(COLONY, 'a'.repeat(32));
    expect(id.length).toBeLessThanOrEqual(64);
    expect(id.startsWith('co_01arz3ndektsv4rrffq69g5fav.')).toBe(true);
    expect(id.endsWith('.terraagent.mock')).toBe(true);
    expect(NearAccountId.safeParse(id).success).toBe(true);
    expect(id).not.toBe(colonyAccountId(COLONY, 'a'.repeat(32)));
  });

  it('adds -2 inside the same budget when the shortened stem is taken', () => {
    const [first, second] = colonyAccountCandidates(COLONY, 'b'.repeat(32));
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
    expect(second?.endsWith('-2.terraagent.mock')).toBe(true);
    expect(second?.startsWith('co_01arz3ndektsv4rrffq69g5fav.')).toBe(true);
    expect(second && second.length).toBeLessThanOrEqual(64);
  });

  it('refuses to drop the colony id when the colony segment alone exceeds 64', () => {
    expect(() => fitColonyAccountId('c'.repeat(63), 'pilot')).toThrow(/colony id/);
  });
});
