import { describe, expect, it } from 'vitest';
import { ProposalOutbox } from '../../src/ai/audit/outbox.js';

const COLONY = 'co_1';

function proposal(requestId: string, fence: number, intentRevision: number, actionId: string) {
  return { requestId, colonyId: COLONY, fence, intentRevision, actions: [{ actionId }] };
}

describe('ProposalOutbox', () => {
  it('duplicate requestId yields one action list', () => {
    const box = new ProposalOutbox();
    const first = proposal('rq_1', 1, 0, 'a1');
    expect(box.accept(first)).toEqual({ ok: true });
    expect(box.accept({ ...first, actions: [{ actionId: 'a2' }] })).toEqual({ ok: true, duplicate: true });
    expect(box.results('rq_1')).toEqual([{ actionId: 'a1' }]);
    expect(box.results('rq_1')).toEqual([{ actionId: 'a1' }]);
  });

  it('lower fence is superseded', () => {
    const box = new ProposalOutbox();
    expect(box.accept(proposal('rq_new', 3, 0, 'new'))).toEqual({ ok: true });
    expect(box.accept(proposal('rq_late', 2, 0, 'late'))).toEqual({ ok: false, outcome: 'superseded' });
    expect(box.results('rq_late')).toBeUndefined();
    expect(box.results('rq_new')).toEqual([{ actionId: 'new' }]);
  });

  it('intent revision 2 then a proposal at revision 1 is superseded', () => {
    const box = new ProposalOutbox();
    box.noteIntent(COLONY, 2);
    expect(box.accept(proposal('rq_old', 1, 1, 'old'))).toEqual({ ok: false, outcome: 'superseded' });
    expect(box.results('rq_old')).toBeUndefined();
  });

  it('a proposal at the current fence and revision is accepted', () => {
    const box = new ProposalOutbox();
    box.noteIntent(COLONY, 2);
    expect(box.accept(proposal('rq_held', 4, 2, 'held'))).toEqual({ ok: true });
    expect(box.accept(proposal('rq_now', 4, 2, 'now'))).toEqual({ ok: true });
    expect(box.results('rq_now')).toEqual([{ actionId: 'now' }]);
  });
});
