import { createHash } from 'node:crypto';
import {
  DeedNftPort,
  normalizeDeedMetadata,
  type DeedMetadataHistoryRecord,
  type DeedNftRecord,
} from '../application/ports/deed-nft.port.js';
import { NearException } from '../domain/errors.js';
import {
  type AccountId,
  type ChainReceipt,
  NftMintInput,
  type NftMintResult,
  NftTokenRef,
  NftUpdateMetadataInput,
} from '../domain/types.js';
import { assertPlainJsonMetadata } from '../infrastructure/mock/nep171.base.js';
import { InMemoryChain } from './in-memory-chain.js';

const COLLECTION = 'deed';

interface StoredDeedToken {
  owner: AccountId;
  metadata: Record<string, unknown>;
  opId: string;
  mintedAt: number;
  updatedAt: number;
  history: DeedMetadataHistoryRecord[];
}

/** In-memory `DeedNftPort` for unit tests: Map state, idempotent by `opId`, monotonic version, one-way `settled`. */
export class InMemoryDeedNft extends DeedNftPort {
  private readonly tokens = new Map<string, StoredDeedToken>();

  constructor(private readonly chain: InMemoryChain = new InMemoryChain()) {
    super();
  }

  async mint(raw: NftMintInput): Promise<NftMintResult> {
    const input = NftMintInput.parse(raw);
    this.assertCollection(input.collection);
    const meta = normalizeDeedMetadata(input.metadata);
    assertPlainJsonMetadata(meta);
    const { value, receipt } = this.chain.write(input.opId, () => {
      const tokenId =
        input.tokenId ??
        `${COLLECTION}-${createHash('sha256').update(`nft:${input.opId}`).digest('hex').slice(0, 16)}`;
      if (this.tokens.has(tokenId)) {
        throw new NearException('NEAR_NFT_EXISTS', { details: { collection: COLLECTION, tokenId } });
      }
      const now = Date.now();
      this.tokens.set(tokenId, {
        owner: input.ownerAccountId,
        metadata: meta,
        opId: input.opId,
        mintedAt: now,
        updatedAt: now,
        history: [{ opId: input.opId, metadata: meta, at: now }],
      });
      return tokenId;
    });
    return { tokenId: value, receipt };
  }

  async updateMetadata(raw: NftUpdateMetadataInput): Promise<ChainReceipt> {
    const input = NftUpdateMetadataInput.parse(raw);
    this.assertCollection(input.collection);
    assertPlainJsonMetadata(input.metadata);
    return this.chain.write(input.opId, () => {
      const token = this.tokens.get(input.tokenId);
      if (!token) {
        throw new NearException('NEAR_NFT_NOT_FOUND', {
          details: { collection: COLLECTION, tokenId: input.tokenId },
        });
      }
      const nextMeta = normalizeDeedMetadata(input.metadata, token.metadata);
      assertPlainJsonMetadata(nextMeta);
      const now = Date.now();
      token.metadata = nextMeta;
      token.updatedAt = now;
      token.history.push({ opId: input.opId, metadata: nextMeta, at: now });
    }).receipt;
  }

  async ownerOf(raw: NftTokenRef): Promise<AccountId | null> {
    const ref = NftTokenRef.parse(raw);
    this.assertCollection(ref.collection);
    return this.tokens.get(ref.tokenId)?.owner ?? null;
  }

  async get(raw: NftTokenRef | string): Promise<DeedNftRecord | null> {
    const ref =
      typeof raw === 'string'
        ? NftTokenRef.parse({ collection: COLLECTION, tokenId: raw })
        : NftTokenRef.parse(raw);
    this.assertCollection(ref.collection);
    const token = this.tokens.get(ref.tokenId);
    if (!token) return null;
    const version =
      typeof token.metadata.version === 'number' && Number.isFinite(token.metadata.version)
        ? token.metadata.version
        : token.history.length;
    const settled = token.metadata.settled === true || token.metadata.status === 'settled';
    return {
      collection: COLLECTION,
      tokenId: ref.tokenId,
      ownerAccountId: token.owner,
      metadata: token.metadata,
      version,
      settled,
      opId: token.opId,
      mintedAt: token.mintedAt,
      updatedAt: token.updatedAt,
      history: [...token.history],
    };
  }

  private assertCollection(collection: string): void {
    if (collection !== COLLECTION) {
      throw new NearException('NEAR_NFT_INVALID', {
        message: `this fake serves collection "${COLLECTION}", got "${collection}"`,
      });
    }
  }
}
