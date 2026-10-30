import type { AccountId, ChainReceipt, NftMintInput, NftMintResult, NftTokenRef, NftUpdateMetadataInput } from '../../domain/types.js';

export abstract class BadgeNftPort {
  abstract mint(input: NftMintInput): Promise<NftMintResult>;
  abstract updateMetadata(input: NftUpdateMetadataInput): Promise<ChainReceipt>;
  /** Null when the token does not exist. */
  abstract ownerOf(input: NftTokenRef): Promise<AccountId | null>;
}
