import type { AccountId, ChainReceipt, OpId, TokenAmount } from '../../domain/types.js';

export interface CreateSubAccountInput { readonly opId: OpId; readonly parent: AccountId; readonly name: string }
export interface CreateSubAccountResult { readonly accountId: AccountId; readonly receipt: ChainReceipt }
export interface AddLimitedKeyInput { readonly opId: OpId; readonly accountId: AccountId; readonly publicKey: string; readonly allowance: TokenAmount; readonly receiverId: AccountId; readonly methodNames: readonly string[] }
export interface RevokeKeyInput { readonly opId: OpId; readonly accountId: AccountId; readonly publicKey: string }

export abstract class AgentWalletPort {
  abstract createSubAccount(input: CreateSubAccountInput): Promise<CreateSubAccountResult>;
  abstract addLimitedKey(input: AddLimitedKeyInput): Promise<ChainReceipt>;
  abstract revokeKey(input: RevokeKeyInput): Promise<ChainReceipt>;
}
