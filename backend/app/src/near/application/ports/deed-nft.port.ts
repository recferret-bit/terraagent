import { NearException } from '../../domain/errors.js';
import type {
  AccountId,
  ChainReceipt,
  NftMintInput,
  NftMintResult,
  NftTokenRef,
  NftUpdateMetadataInput,
} from '../../domain/types.js';

export function normalizeDeedMetadata(
  incoming: Record<string, unknown>,
  prev?: Record<string, unknown>,
): Record<string, unknown> {
  const prevVersion = typeof prev?.version === 'number' && Number.isFinite(prev.version) ? prev.version : 0;
  const rawVersion = typeof incoming.version === 'number' && Number.isFinite(incoming.version) ? incoming.version : undefined;
  const nextVersion = prev === undefined
    ? (rawVersion && rawVersion >= 1 ? Math.floor(rawVersion) : 1)
    : (rawVersion !== undefined && rawVersion > prevVersion ? Math.floor(rawVersion) : prevVersion + 1);

  const prevSettled = prev?.settled === true || prev?.status === 'settled';
  if (prevSettled && incoming.settled === false) {
    throw new NearException('NEAR_NFT_INVALID', {
      message: 'A settled Colony Deed cannot be unsettled (settled is one-way).',
      details: { prevSettled: true, incomingSettled: false },
    });
  }
  const nextSettled = prevSettled || incoming.settled === true || incoming.status === 'settled';
  const nextStatus = nextSettled
    ? 'settled'
    : typeof incoming.status === 'string'
      ? incoming.status
      : typeof prev?.status === 'string'
        ? prev.status
        : 'active';

  return {
    ...(prev ?? {}),
    ...incoming,
    version: nextVersion,
    settled: nextSettled,
    status: nextStatus,
  };
}

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
