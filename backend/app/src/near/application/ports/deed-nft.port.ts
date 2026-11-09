import type {
  AccountId,
  ChainReceipt,
  NftMintInput,
  NftMintResult,
  NftTokenRef,
  NftUpdateMetadataInput,
} from '../../domain/types.js';

export interface DeedMetadataHistoryRecord {
  readonly opId: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly at: number;
}

export interface DeedNftRecord {
  readonly collection: string;
  readonly tokenId: string;
  readonly ownerAccountId: AccountId;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly version: number;
  readonly settled: boolean;
  readonly opId: string;
  readonly mintedAt: number;
  readonly updatedAt: number;
  readonly history: readonly DeedMetadataHistoryRecord[];
}

export const NEAR_ADAPTER_DEED = 'NEAR_ADAPTER_DEED';

/**
 * Colony Deed NFT port (`DeedNftPort`, W20-01 / NEAR §6).
 * Settling is `updateMetadata` with `settled: true` (one-way; there is no separate `markSettled` method).
 */
export abstract class DeedNftPort {
  abstract mint(input: NftMintInput): Promise<NftMintResult>;
  abstract updateMetadata(input: NftUpdateMetadataInput): Promise<ChainReceipt>;
  abstract ownerOf(input: NftTokenRef): Promise<AccountId | null>;
  abstract get(input: NftTokenRef | string): Promise<DeedNftRecord | null>;
}
