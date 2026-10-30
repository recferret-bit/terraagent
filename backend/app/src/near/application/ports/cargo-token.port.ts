import type { AccountId, ChainReceipt, OpId, TokenAmount } from '../../domain/types.js';

/** `tokenId` is a ResourceKey such as `metals.t1`. */
export interface MintCargoInput { readonly opId: OpId; readonly to: AccountId; readonly tokenId: string; readonly amount: TokenAmount }
export interface BurnCargoInput { readonly opId: OpId; readonly from: AccountId; readonly tokenId: string; readonly amount: TokenAmount }
export interface TransferCargoInput { readonly opId: OpId; readonly from: AccountId; readonly to: AccountId; readonly tokenId: string; readonly amount: TokenAmount }
export interface CargoBalanceInput { readonly accountId: AccountId; readonly tokenId: string }

export abstract class CargoTokenPort {
  abstract mint(input: MintCargoInput): Promise<ChainReceipt>;
  abstract burn(input: BurnCargoInput): Promise<ChainReceipt>;
  abstract balanceOf(input: CargoBalanceInput): Promise<TokenAmount>;
  abstract transfer(input: TransferCargoInput): Promise<ChainReceipt>;
}
