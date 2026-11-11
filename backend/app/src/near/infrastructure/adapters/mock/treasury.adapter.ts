import { Injectable } from '@nestjs/common';
import { adapterOf } from '../../../../ports/adapters.js';
import {
  AddMemberInput,
  CreateDaoInput,
  DaoDepositInput,
  DaoGetInput,
  DaoView,
  FinalizeInput,
  ProposeInput,
  RemoveMemberInput,
  TreasuryDaoPort,
  VoteInput,
  type CreateDaoResult,
  type ProposeResult,
} from '../../../application/ports/treasury-dao.port.js';
import type { ChainReceipt } from '../../../domain/types.js';
import { addDaoMember, addProposal, castVote, creditDao, finalizeProposal, removeDaoMember } from '../../../treasury/actions.js';
import { daoAccountIdFor } from '../../../treasury/policy.js';
import { insertDaoIfMissing, readDaoView } from '../../../treasury/store.js';
import { MockChainBase } from '../../mock/mock-chain.base.js';

const PORT = 'TreasuryDao';

/**
 * Postgres mock of a planet treasury DAO (`TreasuryDaoPort`, W22-03 / NEAR-100).
 * Members, `canPropose` and token balances live in `MockChainDao.policy`.
 * Votes live on the proposal. A proposal passes at more than half the members,
 * or with at least two yes votes and no no votes, and the cost is debited on that vote.
 */
@Injectable()
export class MockTreasuryDaoAdapter extends MockChainBase implements TreasuryDaoPort {
  async createDao(raw: CreateDaoInput): Promise<CreateDaoResult> {
    const input = CreateDaoInput.parse(raw);
    const daoAccountId = daoAccountIdFor(input.name);
    const { value, receipt } = await this.callWithResult(PORT, 'createDao', input.opId, async (tx) => {
      await this.ensureAccount(tx, daoAccountId);
      await insertDaoIfMissing(tx, daoAccountId, input.name, input.councilAccountIds);
      return { daoAccountId };
    });
    return { daoAccountId: value.daoAccountId, receipt };
  }

  async propose(raw: ProposeInput): Promise<ProposeResult> {
    const input = ProposeInput.parse(raw);
    const { value, receipt } = await this.callWithResult(PORT, 'propose', input.opId, (tx) => addProposal(tx, input));
    return { proposalId: value.proposalId, receipt };
  }

  async vote(raw: VoteInput): Promise<ChainReceipt> {
    const input = VoteInput.parse(raw);
    return this.call(PORT, 'vote', input.opId, (tx) => castVote(tx, input));
  }

  async finalize(raw: FinalizeInput): Promise<ChainReceipt> {
    const input = FinalizeInput.parse(raw);
    return this.call(PORT, 'finalize', input.opId, (tx) => finalizeProposal(tx, input));
  }

  async deposit(raw: DaoDepositInput): Promise<ChainReceipt> {
    const input = DaoDepositInput.parse(raw);
    return this.call(PORT, 'deposit', input.opId, (tx) => creditDao(tx, input));
  }

  async addMember(raw: AddMemberInput): Promise<ChainReceipt> {
    const input = AddMemberInput.parse(raw);
    return this.call(PORT, 'addMember', input.opId, (tx) => addDaoMember(tx, input));
  }

  async removeMember(raw: RemoveMemberInput): Promise<ChainReceipt> {
    const input = RemoveMemberInput.parse(raw);
    return this.call(PORT, 'removeMember', input.opId, (tx) => removeDaoMember(tx, input));
  }

  async get(raw: DaoGetInput): Promise<DaoView> {
    const input = DaoGetInput.parse(raw);
    return DaoView.parse(await readDaoView(this.prisma, input.daoAccountId));
  }
}

export const adapter = adapterOf({ port: TreasuryDaoPort, kind: 'mock', useClass: MockTreasuryDaoAdapter });
