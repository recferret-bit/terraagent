import { z } from 'zod';
import { AccountId, ChainReceipt, OpId, TokenAmount } from '../../domain/types.js';

/** Env binding `NEAR_ADAPTER_TREASURY` (mock | testnet | devnet | mainnet). */
export const NEAR_ADAPTER_TREASURY = 'NEAR_ADAPTER_TREASURY';

export const DaoVote = z.enum(['approve', 'reject', 'remove']);
export type DaoVote = z.infer<typeof DaoVote>;

export const DaoProposalState = z.enum(['InProgress', 'Approved', 'Rejected', 'Expired']);
export type DaoProposalState = z.infer<typeof DaoProposalState>;

export const CreateDaoInput = z.object({
  opId: OpId,
  name: z.string().min(1).max(64),
  councilAccountIds: z.array(AccountId).max(64),
});
export type CreateDaoInput = z.infer<typeof CreateDaoInput>;

export const CreateDaoResult = z.object({
  daoAccountId: AccountId,
  receipt: ChainReceipt,
});
export type CreateDaoResult = z.infer<typeof CreateDaoResult>;

export const ProposeInput = z.object({
  opId: OpId,
  daoAccountId: AccountId,
  proposer: AccountId,
  description: z.string().min(1).max(500),
  kind: z.string().min(1).max(64),
  payload: z.record(z.string(), z.unknown()),
});
export type ProposeInput = z.infer<typeof ProposeInput>;

export const ProposeResult = z.object({
  proposalId: z.number().int().nonnegative(),
  receipt: ChainReceipt,
});
export type ProposeResult = z.infer<typeof ProposeResult>;

export const VoteInput = z.object({
  opId: OpId,
  daoAccountId: AccountId,
  proposalId: z.number().int().nonnegative(),
  voter: AccountId,
  vote: DaoVote,
});
export type VoteInput = z.infer<typeof VoteInput>;

export const FinalizeInput = z.object({
  opId: OpId,
  daoAccountId: AccountId,
  proposalId: z.number().int().nonnegative(),
});
export type FinalizeInput = z.infer<typeof FinalizeInput>;

export const DaoDepositInput = z.object({
  opId: OpId,
  daoAccountId: AccountId,
  from: AccountId,
  tokenId: z.string().min(1).max(64),
  amount: TokenAmount,
});
export type DaoDepositInput = z.infer<typeof DaoDepositInput>;

/** W22-06: settled colonies stay members with `canPropose: false`. */
export const AddMemberInput = z.object({
  opId: OpId,
  daoAccountId: AccountId,
  member: AccountId,
  canPropose: z.boolean().optional(),
});
export type AddMemberInput = z.infer<typeof AddMemberInput>;

export const RemoveMemberInput = z.object({
  opId: OpId,
  daoAccountId: AccountId,
  member: AccountId,
});
export type RemoveMemberInput = z.infer<typeof RemoveMemberInput>;

export const DaoGetInput = z.object({
  daoAccountId: AccountId,
});
export type DaoGetInput = z.infer<typeof DaoGetInput>;

export const DaoMemberView = z.strictObject({
  accountId: AccountId,
  canPropose: z.boolean(),
});
export type DaoMemberView = z.infer<typeof DaoMemberView>;

export const DaoProposalView = z.strictObject({
  proposalId: z.number().int().nonnegative(),
  proposer: AccountId,
  kind: z.string().min(1),
  description: z.string(),
  state: DaoProposalState,
  yes: z.number().int().nonnegative(),
  no: z.number().int().nonnegative(),
  votes: z.array(z.strictObject({ voter: AccountId, vote: DaoVote })),
});
export type DaoProposalView = z.infer<typeof DaoProposalView>;

export const DaoView = z.strictObject({
  daoAccountId: AccountId,
  name: z.string().min(1),
  members: z.array(DaoMemberView),
  /** Token id → whole base units held by the DAO. */
  balances: z.record(z.string(), TokenAmount),
  proposals: z.array(DaoProposalView),
});
export type DaoView = z.infer<typeof DaoView>;

/**
 * Planet treasury DAO (`TreasuryDaoPort`, W00-30 + W22-01, NEAR §10).
 * Missing DAOs throw `DAO_NOT_FOUND`. A second vote throws `ALREADY_VOTED`.
 * A closed proposal throws `PROPOSAL_CLOSED`. A non-member throws `NOT_A_MEMBER`.
 * A project the balance cannot cover throws `TREASURY_INSUFFICIENT`.
 */
export abstract class TreasuryDaoPort {
  abstract createDao(input: CreateDaoInput): Promise<CreateDaoResult>;
  abstract propose(input: ProposeInput): Promise<ProposeResult>;
  abstract vote(input: VoteInput): Promise<ChainReceipt>;
  abstract finalize(input: FinalizeInput): Promise<ChainReceipt>;
  abstract deposit(input: DaoDepositInput): Promise<ChainReceipt>;
  abstract addMember(input: AddMemberInput): Promise<ChainReceipt>;
  abstract removeMember(input: RemoveMemberInput): Promise<ChainReceipt>;
  abstract get(input: DaoGetInput): Promise<DaoView>;
}
