import type { AccountId, ChainReceipt, OpId, TokenAmount } from '../../domain/types.js';

export const CARGO_DECIMALS = 18;
export const CARGO_BASE_UNIT = 10n ** 18n;
export const CARGO_MINTER_ACCOUNT: AccountId = 'minter.terraagent.mock';

export const toCargoBaseUnits = (majorUnits: number | bigint): TokenAmount =>
  String(BigInt(majorUnits) * CARGO_BASE_UNIT);

export const fromCargoBaseUnits = (baseUnits: TokenAmount): number =>
  Number(BigInt(baseUnits) / CARGO_BASE_UNIT);

/** `tokenId` is a ResourceKey such as `metals.t1`. */
export interface MintCargoInput {
  readonly opId: OpId;
  readonly to: AccountId;
  readonly tokenId: string;
  readonly amount: TokenAmount;
  readonly caller?: AccountId;
}
export interface BurnCargoInput {
  readonly opId: OpId;
  readonly from: AccountId;
  readonly tokenId: string;
  readonly amount: TokenAmount;
  readonly caller?: AccountId;
}
export interface TransferCargoInput {
  readonly opId: OpId;
  readonly from: AccountId;
  readonly to: AccountId;
  readonly tokenId: string;
  readonly amount: TokenAmount;
}
export interface CargoBalanceInput {
  readonly accountId: AccountId;
  readonly tokenId: string;
}

export abstract class CargoTokenPort {
  abstract mint(input: MintCargoInput): Promise<ChainReceipt>;
  abstract burn(input: BurnCargoInput): Promise<ChainReceipt>;
  abstract balanceOf(input: CargoBalanceInput): Promise<TokenAmount>;
  abstract transfer(input: TransferCargoInput): Promise<ChainReceipt>;
}
