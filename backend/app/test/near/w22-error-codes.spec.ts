import { describe, expect, it } from 'vitest';
import { mapError, restCodeFor } from '../../src/core/errors/map-error';
import { NEAR_ERROR_CODES, NearException } from '../../src/near/domain/errors';
import {
  AddMemberInput,
  DaoGetInput,
  DaoView,
  RemoveMemberInput,
  TreasuryDaoPort,
} from '../../src/near/application/ports/treasury-dao.port';

describe('W22-01 treasury error codes and TreasuryDaoPort schemas', () => {
  it('maps each council error to its HTTP status and REST code', () => {
    const expected = {
      DAO_NOT_FOUND: { status: 404, restCode: 'dao_not_found', description: 'No planet council with this id.' },
      NOT_A_MEMBER: { status: 403, restCode: 'not_a_member', description: 'That colony is not a member of this planet council.' },
      ALREADY_VOTED: { status: 409, restCode: 'already_voted', description: 'This colony already voted on that proposal.' },
      TREASURY_INSUFFICIENT: { status: 409, restCode: 'treasury_insufficient', description: 'The planet treasury cannot cover this project.' },
      PROPOSAL_CLOSED: { status: 409, restCode: 'proposal_closed', description: 'That proposal is no longer open.' },
    } as const;
    for (const code of Object.keys(expected) as (keyof typeof expected)[]) {
      const err = new NearException(code);
      expect(err.status).toBe(expected[code].status);
      expect(err.message).toBe(expected[code].description);
      expect(NEAR_ERROR_CODES[code].status).toBe(expected[code].status);
      expect(restCodeFor(err.status, code)).toBe(expected[code].restCode);
      expect(mapError(err).errorCode).toBe(code);
    }
  });

  it('parses addMember, removeMember and get, and rejects a bad account', () => {
    expect(TreasuryDaoPort).toBeDefined();
    expect(TreasuryDaoPort.prototype.createDao).toBeUndefined();
    const member = 'col-a.pilot.terraagent.mock';
    const dao = 'pl-dune.dao.mock';
    expect(AddMemberInput.parse({ opId: 'dao-member:pl-dune:col-a', daoAccountId: dao, member, canPropose: false }).canPropose).toBe(false);
    expect(RemoveMemberInput.parse({ opId: 'dao-leave:pl-dune:col-a', daoAccountId: dao, member }).member).toBe(member);
    expect(DaoGetInput.safeParse({ daoAccountId: 'NOT AN ACCOUNT' }).success).toBe(false);
    const view = DaoView.parse({
      daoAccountId: dao,
      name: 'pl-dune',
      members: [{ accountId: member, canPropose: true }],
      balances: { 'metals.t1': '1500' },
      proposals: [],
    });
    expect(view.balances['metals.t1']).toBe('1500');
    expect(DaoView.safeParse({ ...view, extra: 1 }).success).toBe(false);
  });
});
