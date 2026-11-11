import { z } from 'zod';
import { CoreException } from '../../core/errors/core-exception.js';
import { opId } from '../application/outbox/op-id.js';
import type { DaoView } from '../application/ports/treasury-dao.port.js';
import { NearException } from '../domain/errors.js';

const ProposeBodySchema = z.object({
  kind: z.string().min(1).max(64),
  description: z.string().min(1).max(500).optional(),
});

const VoteBodySchema = z.object({
  vote: z.enum(['approve', 'reject']),
});

export interface ProposeBody {
  readonly kind: string;
  readonly description?: string;
}

export function parseProposeBody(raw: unknown): ProposeBody {
  const parsed = ProposeBodySchema.safeParse(raw ?? {});
  if (!parsed.success) throw new CoreException('invalid_args', { status: 400, message: 'Proposal body is invalid.' });
  return parsed.data;
}

export function parseVoteBody(raw: unknown): 'approve' | 'reject' {
  const parsed = VoteBodySchema.safeParse(raw ?? {});
  if (!parsed.success) throw new CoreException('invalid_args', { status: 400, message: 'Vote must be approve or reject.' });
  return parsed.data.vote;
}

export function parseProposalId(id: string): number {
  if (!/^(0|[1-9]\d*)$/.test(id)) throw new CoreException('invalid_args', { status: 400, message: 'Proposal id is invalid.' });
  return Number(id);
}

/** One chain op per colony attempt. A retry of the same attempt replays; the next attempt is a new id. */
export function daoProposeOpId(planetId: string, accountId: string, seq: number): string {
  return opId('dao-propose', planetId, accountId, seq);
}

/** One chain op per member per proposal, so a relay retry does not cast a second vote. */
export function daoVoteOpId(planetId: string, proposalId: number, accountId: string): string {
  return opId('dao-vote', planetId, proposalId, accountId);
}

export function assertNoOpenProposal(view: DaoView, accountId: string): void {
  const open = view.proposals.some((row) => row.proposer === accountId && row.state === 'InProgress');
  if (open) throw new NearException('PROPOSAL_OPEN', { details: { accountId } });
}

export function assertNotVoted(view: DaoView, proposalId: number, accountId: string): void {
  const row = view.proposals.find((proposal) => proposal.proposalId === proposalId);
  if (row?.votes.some((vote) => vote.voter === accountId)) {
    throw new NearException('ALREADY_VOTED', { details: { proposalId, voter: accountId } });
  }
}

export function proposeSeq(view: DaoView, accountId: string): number {
  return view.proposals.filter((row) => row.proposer === accountId).length + 1;
}
