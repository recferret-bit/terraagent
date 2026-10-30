import type { AccountId, ChainReceipt, OpId } from '../../domain/types.js';

export interface SubmitMetaTxInput { readonly opId: OpId; readonly signerId: AccountId; readonly receiverId: AccountId; readonly signedDelegate: string }

export abstract class RelayerPort {
  abstract submitMetaTx(input: SubmitMetaTxInput): Promise<ChainReceipt>;
}
