import { DEFAULT_DIRECTOR_POLICY, type DirectorPolicyV1 } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { partitionExpired } from '../../src/ai/audit/expire';
import { MemoryDirectorAudit } from '../../src/ai/audit/memory-store';
import type { DirectorContextRecord, DirectorDecisionRecord } from '../../src/ai/audit/types';

const COLONY = 'col-w16-15';
const PLANET = 'pl-dune-1';

function policyAll100(revision = 4): DirectorPolicyV1 {
  return {
    ...DEFAULT_DIRECTOR_POLICY,
    risk: 'conservative',
    priorities: { economy: 100, expansion: 100, defense: 100, power: 100, terraform: 100 },
    revision,
  };
}

function contextRow(id: string, expiresAtMs: number): DirectorContextRecord {
  return { id, colonyId: COLONY, epoch: 1, revision: 4, bytes: 2, document: {}, expiresAtMs };
}

function decisionRow(id: string, expiresAtMs: number): DirectorDecisionRecord {
  return { id, colonyId: COLONY, outcome: 'applied', summary: 'held', expiresAtMs };
}

describe('partitionExpired', () => {
  it('selects context and decisions at or before now', () => {
    const contexts = [contextRow('c-now', 1000), contextRow('c-later', 1001)];
    const decisions = [decisionRow('d-now', 1000), decisionRow('d-later', 5000)];
    const doomed = partitionExpired(1000, contexts, decisions);
    expect(doomed.contexts.map((row) => row.id)).toEqual(['c-now']);
    expect(doomed.decisions.map((row) => row.id)).toEqual(['d-now']);
    expect(contexts).toHaveLength(2);
    expect(decisions).toHaveLength(2);
  });
});

describe('MemoryDirectorAudit', () => {
  it('round-trips policy and expires context without deleting it', () => {
    const store = new MemoryDirectorAudit();
    const saved = policyAll100();
    store.savePolicy(COLONY, PLANET, saved);
    saved.priorities.economy = 1;

    const brief = { brief: 'short' };
    store.saveContext({
      id: 'ctx-1',
      colonyId: COLONY,
      epoch: 2,
      revision: 4,
      document: brief,
      expiresAtMs: 1000,
    });
    brief.brief = 'mutated';
    store.saveDecision({
      id: 'dec-1000',
      colonyId: COLONY,
      outcome: 'rejected',
      summary: 'too late',
      expiresAtMs: 1000,
    });
    store.saveDecision({
      id: 'dec-5000',
      colonyId: COLONY,
      outcome: 'applied',
      summary: 'held the ridge',
      expiresAtMs: 5000,
    });

    expect(store.context('ctx-1')?.document).toEqual({ brief: 'short' });
    expect(store.context('ctx-1')?.bytes).toBe(Buffer.byteLength(JSON.stringify({ brief: 'short' }), 'utf8'));
    expect(store.expire(999)).toEqual({ contexts: 0, decisions: 0 });
    expect(store.expire(1000)).toEqual({ contexts: 1, decisions: 1 });
    expect(store.context('ctx-1')).toBeUndefined();
    expect(store.decision('dec-1000')).toBeUndefined();
    expect(store.decision('dec-5000')?.summary).toBe('held the ridge');

    const read = store.readPolicy(COLONY);
    expect(read).not.toBeNull();
    if (!read) return;
    expect(read.revision).toBe(4);
    expect(read.planetId).toBe(PLANET);
    expect(read.policy).toEqual(policyAll100());
    const { economy, expansion, defense, power, terraform } = read.policy.priorities;
    expect(economy + expansion + defense + power + terraform).toBe(500);
    expect(read.policy.risk).toBe('conservative');

    expect(store.expire(5000)).toEqual({ contexts: 0, decisions: 1 });
    expect(store.decision('dec-5000')).toBeUndefined();
    expect(store.readPolicy(COLONY)?.revision).toBe(4);
  });

  it('replaces one policy row per colony', () => {
    const store = new MemoryDirectorAudit();
    store.savePolicy(COLONY, PLANET, policyAll100(4));
    store.savePolicy(COLONY, 'pl-other', { ...policyAll100(5), risk: 'risky' });
    const read = store.readPolicy(COLONY);
    expect(read?.revision).toBe(5);
    expect(read?.policy.revision).toBe(5);
    expect(read?.planetId).toBe('pl-other');
    expect(read?.policy.risk).toBe('risky');
    expect(read?.policy.priorities.economy).toBe(100);
  });

  it('rejects corrupt policy JSON', () => {
    const store = new MemoryDirectorAudit();
    store.loadUnchecked(COLONY, { version: 1, risk: 'conservative', awayRaids: true });
    expect(() => store.readPolicy(COLONY)).toThrow(ZodError);
  });

  it('returns null when the colony has no policy', () => {
    expect(new MemoryDirectorAudit().readPolicy(COLONY)).toBeNull();
  });
});
