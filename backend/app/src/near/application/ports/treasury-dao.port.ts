import type { AccountId, ChainReceipt, OpId, TokenAmount } from '../../domain/types.js';

export interface CreateDaoInput { readonly opId: OpId; readonly name: string; readonly councilAccountIds: readonly AccountId[] }
export interface CreateDaoResult { readonly daoAccountId: AccountId; readonly receipt: ChainReceipt }
export interface ProposeInput { readonly opId: OpId; readonly daoAccountId: AccountId; readonly proposer: AccountId; readonly description: string; readonly kind: string; readonly payload: Readonly<Record<string, unknown>> }
export interface ProposeResult { readonly proposalId: number; readonly receipt: ChainReceipt }
export interface VoteInput { readonly opId: OpId; readonly daoAccountId: AccountId; readonly proposalId: number; readonly voter: AccountId; readonly vote: 'approve' | 'reject' | 'remove' }
export interface FinalizeInput { readonly opId: OpId; readonly daoAccountId: AccountId; readonly proposalId: number }
export interface DaoDepositInput { readonly opId: OpId; readonly daoAccountId: AccountId; readonly from: AccountId; readonly tokenId: string; readonly amount: TokenAmount }

export abstract class TreasuryDaoPort {
  abstract createDao(input: CreateDaoInput): Promise<CreateDaoResult>;
  abstract propose(input: ProposeInput): Promise<ProposeResult>;
  abstract vote(input: VoteInput): Promise<ChainReceipt>;
  abstract finalize(input: FinalizeInput): Promise<ChainReceipt>;
  abstract deposit(input: DaoDepositInput): Promise<ChainReceipt>;
}
