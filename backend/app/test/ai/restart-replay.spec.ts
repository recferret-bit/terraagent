import { describe, expect, it } from 'vitest';
import { ProposalOutbox } from '../../src/ai/audit/outbox.js';
import { GlobalTokenBudget } from '../../src/ai/budget/global.js';
import { JobClaims } from '../../../director/src/claim.js';

describe('W16-44 restart replay', () => {
  it('keeps a token reservation, a fence, and a claim across a snapshot restart', () => {
    const budget = new GlobalTokenBudget(100);
    expect(budget.reserve('2026-11-04', 80).ok).toBe(true);
    const restoredBudget = GlobalTokenBudget.fromSnapshot(budget.snapshot());
    expect(restoredBudget.reserve('2026-11-04', 30).ok).toBe(false);

    const box = new ProposalOutbox();
    box.accept({ requestId: 'req_1', colonyId: 'co_1', fence: 4, intentRevision: 1, actions: [{ actionId: 'a' }] });
    const restoredBox = ProposalOutbox.fromSnapshot(box.snapshot());
    expect(restoredBox.accept({ requestId: 'req_1', colonyId: 'co_1', fence: 4, intentRevision: 1, actions: [{ actionId: 'b' }] })).toEqual({ ok: true, duplicate: true });
    expect(restoredBox.accept({ requestId: 'req_2', colonyId: 'co_1', fence: 3, intentRevision: 1, actions: [] }).ok).toBe(false);

    const claims = new JobClaims();
    claims.claim('job_1', 'worker-a', 2);
    const restoredClaims = JobClaims.fromSnapshot(claims.snapshot());
    expect(restoredClaims.claim('job_1', 'worker-b', 2)).toBe('busy');
  });
});
