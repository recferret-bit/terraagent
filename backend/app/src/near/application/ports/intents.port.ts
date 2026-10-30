import type { AccountId, ChainReceipt, OpId, TokenAmount } from '../../domain/types.js';

/** Signed per-token deltas (decimal strings, may be negative); a valid set sums to zero per token. */
export interface TokenDiff { readonly accountId: AccountId; readonly deltas: Readonly<Record<string, string>> }
export interface IntentsDepositInput { readonly opId: OpId; readonly accountId: AccountId; readonly tokenId: string; readonly amount: TokenAmount }
export interface IntentsWithdrawInput { readonly opId: OpId; readonly accountId: AccountId; readonly tokenId: string; readonly amount: TokenAmount; readonly to: AccountId }
export interface SignTokenDiffInput { readonly accountId: AccountId; readonly deltas: Readonly<Record<string, string>>; readonly deadlineMs: number }
export interface SignedIntent { readonly diff: TokenDiff; readonly signature: string; readonly nonce: string; readonly deadlineMs: number }
export interface IntentsSimulation { readonly ok: boolean; readonly errorCode?: string; readonly effects: readonly TokenDiff[] }
export interface IntentsExecuteInput { readonly opId: OpId; readonly intents: readonly SignedIntent[] }

export abstract class IntentsPort {
  abstract deposit(input: IntentsDepositInput): Promise<ChainReceipt>;
  abstract signTokenDiff(input: SignTokenDiffInput): Promise<SignedIntent>;
  abstract simulate(intents: readonly SignedIntent[]): Promise<IntentsSimulation>;
  abstract execute(input: IntentsExecuteInput): Promise<ChainReceipt>;
  abstract withdraw(input: IntentsWithdrawInput): Promise<ChainReceipt>;
}
