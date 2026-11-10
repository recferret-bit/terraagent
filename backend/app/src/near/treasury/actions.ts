import type { DbClient } from '@terra/db';
import type {
  AddMemberInput,
  DaoDepositInput,
  FinalizeInput,
  ProposeInput,
  RemoveMemberInput,
  VoteInput,
} from '../application/ports/treasury-dao.port.js';
import { NearException } from '../domain/errors.js';
import { assertCanPropose, assertMember, withMember, withoutMember } from './members.js';
import { covers, creditBalance, proposalKindJson, readCost, settleCost, type ProposalStatus, type StoredProposal } from './policy.js';
import { proposalPasses, tallyMemberVotes } from './pass-rule.js';
import {
  nextProposalId,
  requireDao,
  requireProposal,
  writePolicy,
  writeProposal,
  type LoadedDao,
} from './store.js';

export async function creditDao(tx: DbClient, input: DaoDepositInput): Promise<{ from: string; tokenId: string; amount: string; balance: string }> {
  const dao = await requireDao(tx, input.daoAccountId);
  const policy = creditBalance(dao.policy, input.tokenId, input.amount);
  await writePolicy(tx, input.daoAccountId, policy);
  return { from: input.from, tokenId: input.tokenId, amount: input.amount, balance: policy.balances[input.tokenId] ?? '0' };
}

export async function addDaoMember(tx: DbClient, input: AddMemberInput): Promise<{ member: string; canPropose: boolean }> {
  const dao = await requireDao(tx, input.daoAccountId);
  const policy = withMember(dao.policy, input.member, input.canPropose);
  if (policy !== dao.policy) await writePolicy(tx, input.daoAccountId, policy);
  return { member: input.member, canPropose: policy.members.find((member) => member.accountId === input.member)?.canPropose ?? true };
}

export async function removeDaoMember(tx: DbClient, input: RemoveMemberInput): Promise<{ member: string; removed: boolean }> {
  const dao = await requireDao(tx, input.daoAccountId);
  const policy = withoutMember(dao.policy, input.member);
  const removed = policy !== dao.policy;
  if (removed) await writePolicy(tx, input.daoAccountId, policy);
  return { member: input.member, removed };
}

export async function addProposal(tx: DbClient, input: ProposeInput): Promise<{ proposalId: number }> {
  const dao = await requireDao(tx, input.daoAccountId);
  assertCanPropose(dao.policy, input.proposer);
  const priced = readCost(input.payload);
  if (priced.cost !== undefined && priced.tokenId !== undefined && !covers(dao.policy, priced.tokenId, priced.cost)) {
    throw new NearException('TREASURY_INSUFFICIENT', {
      details: { tokenId: priced.tokenId, cost: priced.cost, available: dao.policy.balances[priced.tokenId] ?? '0' },
    });
  }
  const proposal: StoredProposal = {
    id: nextProposalId(dao.proposals),
    proposer: input.proposer,
    status: 'InProgress',
    votes: [],
    kind: input.kind,
    description: input.description,
    payload: input.payload,
    cost: priced.cost,
    tokenId: priced.tokenId,
    debited: false,
  };
  await tx.mockChainDaoProposal.create({
    data: {
      daoId: input.daoAccountId,
      id: proposal.id,
      proposer: input.proposer,
      status: 'InProgress',
      votes: [],
      kind: proposalKindJson(proposal),
    },
  });
  return { proposalId: proposal.id };
}

export async function castVote(tx: DbClient, input: VoteInput): Promise<{ proposalId: number; status: ProposalStatus }> {
  const dao = await requireDao(tx, input.daoAccountId);
  assertMember(dao.policy, input.voter);
  const proposal = requireProposal(dao, input.proposalId);
  if (proposal.status !== 'InProgress') {
    throw new NearException('PROPOSAL_CLOSED', { details: { proposalId: input.proposalId, status: proposal.status } });
  }
  if (proposal.votes.some((vote) => vote.voter === input.voter)) {
    throw new NearException('ALREADY_VOTED', { details: { proposalId: input.proposalId, voter: input.voter } });
  }
  const next: StoredProposal = { ...proposal, votes: [...proposal.votes, { voter: input.voter, vote: input.vote }] };
  if (!rulePasses(dao, next)) {
    await writeProposal(tx, input.daoAccountId, next);
    return { proposalId: next.id, status: 'InProgress' };
  }
  return approvePassed(tx, input.daoAccountId, dao, next);
}

export async function finalizeProposal(tx: DbClient, input: FinalizeInput): Promise<{ proposalId: number; status: ProposalStatus }> {
  const dao = await requireDao(tx, input.daoAccountId);
  const proposal = requireProposal(dao, input.proposalId);
  if (proposal.status !== 'InProgress') return { proposalId: proposal.id, status: proposal.status };
  if (!rulePasses(dao, proposal)) {
    await writeProposal(tx, input.daoAccountId, { ...proposal, status: 'Expired' });
    return { proposalId: proposal.id, status: 'Expired' };
  }
  return approvePassed(tx, input.daoAccountId, dao, proposal);
}

/** Open votes from accounts that are no longer members do not count (W22-06). */
function rulePasses(dao: LoadedDao, proposal: StoredProposal): boolean {
  const memberIds = dao.policy.members.map((member) => member.accountId);
  return proposalPasses(tallyMemberVotes(proposal.votes, memberIds));
}

/** Debits on the deciding vote. A short balance throws and the transaction drops the vote. */
async function approvePassed(tx: DbClient, daoAccountId: string, dao: LoadedDao, proposal: StoredProposal): Promise<{ proposalId: number; status: ProposalStatus }> {
  const paid = settleCost(dao.policy, proposal);
  if (!paid) {
    throw new NearException('TREASURY_INSUFFICIENT', {
      details: {
        proposalId: proposal.id,
        tokenId: proposal.tokenId,
        cost: proposal.cost,
        available: proposal.tokenId ? dao.policy.balances[proposal.tokenId] ?? '0' : '0',
      },
    });
  }
  if (paid.policy !== dao.policy) await writePolicy(tx, daoAccountId, paid.policy);
  await writeProposal(tx, daoAccountId, { ...proposal, status: 'Approved', debited: paid.debited });
  return { proposalId: proposal.id, status: 'Approved' };
}
