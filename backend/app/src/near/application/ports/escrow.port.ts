import type { AccountId, ChainReceipt, OpId, TokenAmount } from '../../domain/types.js';

export interface EscrowOpenInput { readonly opId: OpId; readonly funder: AccountId; readonly beneficiary: AccountId; readonly tokenId: string; readonly amount: TokenAmount; readonly expiresAtMs: number }
export interface EscrowOpenResult { readonly escrowId: string; readonly receipt: ChainReceipt }
export interface EscrowActionInput { readonly opId: OpId; readonly escrowId: string; readonly caller: AccountId }

export abstract class EscrowPort {
  abstract open(input: EscrowOpenInput): Promise<EscrowOpenResult>;
  abstract claim(input: EscrowActionInput): Promise<ChainReceipt>;
  abstract refund(input: EscrowActionInput): Promise<ChainReceipt>;
}
