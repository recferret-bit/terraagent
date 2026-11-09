import { Injectable } from '@nestjs/common';
import { adapterOf } from '../../../../ports/adapters.js';
import {
  DeedNftPort,
  normalizeDeedMetadata,
  type DeedMetadataHistoryRecord,
  type DeedNftRecord,
} from '../../../application/ports/deed-nft.port.js';
import { NearException } from '../../../domain/errors.js';
import {
  type AccountId,
  type ChainReceipt,
  type NftMintInput,
  type NftMintResult,
  NftTokenRef,
  NftUpdateMetadataInput,
} from '../../../domain/types.js';
import { assertPlainJsonMetadata, BaseNep171MockAdapter } from '../../mock/nep171.base.js';

export { normalizeDeedMetadata };

const COLLECTION = 'deed';

/**
 * NEP-171 mock adapter for Colony Deeds (`DeedNftPort`, W20-03 / NEAR §6).
 * Enforces collection `'deed'`, monotonic metadata `version`, and one-way `settled: true`.
 */
@Injectable()
export class MockDeedNftAdapter extends BaseNep171MockAdapter implements DeedNftPort {
  protected readonly collection = COLLECTION;
  protected readonly portName = 'DeedNft';

  override async mint(raw: NftMintInput): Promise<NftMintResult> {
    assertPlainJsonMetadata(raw.metadata);
    const metadata =
      raw && typeof raw.metadata === 'object' && raw.metadata !== null && !Array.isArray(raw.metadata)
        ? normalizeDeedMetadata(raw.metadata as Record<string, unknown>)
        : raw.metadata;
    return super.mint({ ...raw, metadata });
  }

  override async updateMetadata(raw: NftUpdateMetadataInput): Promise<ChainReceipt> {
    const input = NftUpdateMetadataInput.parse(raw);
    if (input.collection !== COLLECTION) {
      throw new NearException('NEAR_NFT_INVALID', {
        message: `this adapter serves collection "${COLLECTION}", got "${input.collection}"`,
      });
    }
    assertPlainJsonMetadata(input.metadata);
    const { receipt } = await this.callWithResult(this.portName, 'updateMetadata', input.opId, async (tx) => {
      const key = { collection_tokenId: { collection: COLLECTION, tokenId: input.tokenId } };
      const existing = await tx.mockChainNft.findUnique({ where: key });
      if (!existing) {
        throw new NearException('NEAR_NFT_NOT_FOUND', {
          details: { collection: COLLECTION, tokenId: input.tokenId },
        });
      }
      const prev = (existing.metadata && typeof existing.metadata === 'object' && !Array.isArray(existing.metadata)
        ? existing.metadata
        : {}) as Record<string, unknown>;
      const nextMeta = normalizeDeedMetadata(input.metadata, prev);
      assertPlainJsonMetadata(nextMeta);
      const json = nextMeta as object;
      await tx.mockChainNft.update({
        where: key,
        data: { metadata: json, updatedAt: new Date() },
      });
      await tx.mockChainNftMetaHistory.create({
        data: { collection: COLLECTION, tokenId: input.tokenId, metadata: json, opId: input.opId },
      });
      return { tokenId: input.tokenId };
    });
    return receipt;
  }

  async get(raw: NftTokenRef | string): Promise<DeedNftRecord | null> {
    const ref: NftTokenRef =
      typeof raw === 'string'
        ? NftTokenRef.parse({ collection: COLLECTION, tokenId: raw })
        : NftTokenRef.parse(raw);
    if (ref.collection !== COLLECTION) {
      throw new NearException('NEAR_NFT_INVALID', {
        message: `this adapter serves collection "${COLLECTION}", got "${ref.collection}"`,
      });
    }

    const row = await this.prisma.mockChainNft.findUnique({
      where: { collection_tokenId: { collection: COLLECTION, tokenId: ref.tokenId } },
    });
    if (!row) return null;

    const historyRows = await this.prisma.mockChainNftMetaHistory.findMany({
      where: { collection: COLLECTION, tokenId: ref.tokenId },
      orderBy: { id: 'asc' },
    });
    const meta = (row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? row.metadata
      : {}) as Record<string, unknown>;
    const version = typeof meta.version === 'number' && Number.isFinite(meta.version)
      ? meta.version
      : Math.max(1, historyRows.length);
    const settled = meta.settled === true || meta.status === 'settled';
    const history: DeedMetadataHistoryRecord[] = historyRows.map((h) => ({
      opId: h.opId,
      metadata: (h.metadata && typeof h.metadata === 'object' && !Array.isArray(h.metadata)
        ? h.metadata
        : {}) as Record<string, unknown>,
      at: h.at.getTime(),
    }));

    return {
      collection: row.collection,
      tokenId: row.tokenId,
      ownerAccountId: row.ownerAccountId as AccountId,
      metadata: meta,
      version,
      settled,
      opId: row.opId,
      mintedAt: row.mintedAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
      history,
    };
  }
}

export const adapter = adapterOf({ port: DeedNftPort, kind: 'mock', useClass: MockDeedNftAdapter });
