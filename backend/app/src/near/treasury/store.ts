import type { DbClient } from '@terra/db';
import { NearException } from '../domain/errors.js';
import type { DaoView } from '../application/ports/treasury-dao.port.js';
import { tallyVotes } from './pass-rule.js';
import {
  asJson,
  initialPolicy,
  parsePolicy,
  proposalKindJson,
  readProposal,
  type DaoPolicy,
  type StoredProposal,
} from './policy.js';

export interface LoadedDao {
  readonly policy: DaoPolicy;
  readonly proposals: readonly StoredProposal[];
}

export async function insertDaoIfMissing(tx: DbClient, daoAccountId: string, name: string, council: readonly string[]): Promise<void> {
  const existing = await tx.mockChainDao.findUnique({ where: { id: daoAccountId } });
  if (existing) return;
  await tx.mockChainDao.create({ data: { id: daoAccountId, policy: asJson(initialPolicy(name, council)) } });
}

/** Locks the DAO row so two proposals cannot take the same id. */
export async function requireDao(tx: DbClient, daoAccountId: string): Promise<LoadedDao> {
  const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM chain.mock_chain_dao WHERE id = ${daoAccountId} FOR UPDATE`;
  if (locked.length !== 1) throw new NearException('DAO_NOT_FOUND', { details: { daoAccountId } });
  const row = await tx.mockChainDao.findUnique({
    where: { id: daoAccountId },
    include: { proposals: { orderBy: { id: 'asc' } } },
  });
  if (!row) throw new NearException('DAO_NOT_FOUND', { details: { daoAccountId } });
  return { policy: parsePolicy(row.policy), proposals: row.proposals.map(readProposal) };
}

export function requireProposal(dao: LoadedDao, proposalId: number): StoredProposal {
  const found = dao.proposals.find((proposal) => proposal.id === proposalId);
  if (!found) throw new NearException('DAO_NOT_FOUND', { details: { proposalId } });
  return found;
}

export async function writePolicy(tx: DbClient, daoAccountId: string, policy: DaoPolicy): Promise<void> {
  await tx.mockChainDao.update({ where: { id: daoAccountId }, data: { policy: asJson(policy) } });
}

export async function writeProposal(tx: DbClient, daoAccountId: string, proposal: StoredProposal): Promise<void> {
  await tx.mockChainDaoProposal.update({
    where: { daoId_id: { daoId: daoAccountId, id: proposal.id } },
    data: { status: proposal.status, votes: asJson(proposal.votes), kind: proposalKindJson(proposal) },
  });
}

export async function readDaoView(db: DbClient, daoAccountId: string): Promise<DaoView> {
  const row = await db.mockChainDao.findUnique({
    where: { id: daoAccountId },
    include: { proposals: { orderBy: { id: 'asc' } } },
  });
  if (!row) throw new NearException('DAO_NOT_FOUND', { details: { daoAccountId } });
  return toDaoView(daoAccountId, parsePolicy(row.policy), row.proposals.map(readProposal));
}

export function toDaoView(daoAccountId: string, policy: DaoPolicy, proposals: readonly StoredProposal[]): DaoView {
  return {
    daoAccountId,
    name: policy.name,
    members: policy.members.map((member) => ({ accountId: member.accountId, canPropose: member.canPropose })),
    balances: { ...policy.balances },
    proposals: proposals.map((proposal) => {
      const tally = tallyVotes(proposal.votes);
      return {
        proposalId: proposal.id,
        proposer: proposal.proposer,
        kind: proposal.kind,
        description: proposal.description,
        state: proposal.status,
        yes: tally.yes,
        no: tally.no,
        votes: proposal.votes.map((vote) => ({ voter: vote.voter, vote: vote.vote })),
      };
    }),
  };
}

export function nextProposalId(proposals: readonly StoredProposal[]): number {
  return proposals.reduce((max, proposal) => Math.max(max, proposal.id), -1) + 1;
}
