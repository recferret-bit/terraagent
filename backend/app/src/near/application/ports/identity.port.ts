import type { AccountId, ChainReceipt } from '../../domain/types.js';

export interface SocialLoginInput { readonly provider: string; readonly token: string }
export interface SocialLoginResult { readonly playerId: string; readonly email: string | null; readonly isNew: boolean }
export interface CreateNamedAccountInput { readonly opId: string; readonly name: string; readonly parent?: AccountId }
export interface CreateNamedAccountResult { readonly accountId: AccountId; readonly receipt: ChainReceipt }
export interface ClaimAccountInput { readonly opId: string; readonly accountId: AccountId; readonly walletAccountId: AccountId; readonly walletPublicKey: string }

export abstract class IdentityPort {
  abstract loginSocial(input: SocialLoginInput): Promise<SocialLoginResult>;
  abstract createNamedAccount(input: CreateNamedAccountInput): Promise<CreateNamedAccountResult>;
  abstract claimAccount(input: ClaimAccountInput): Promise<ChainReceipt>;
}
