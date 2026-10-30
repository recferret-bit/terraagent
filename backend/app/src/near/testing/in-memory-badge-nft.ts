import { createHash } from 'node:crypto';
import { BadgeNftPort } from '../application/ports/badge-nft.port';
import { NearException } from '../domain/errors';
import type { AccountId, ChainReceipt, NftMintInput, NftMintResult, NftTokenRef, NftUpdateMetadataInput } from '../domain/types';
import { assertPlainJsonMetadata } from '../infrastructure/mock/nep171.base';
import { InMemoryChain } from './in-memory-chain';

const COLLECTION = 'badge';

/** In-memory `BadgeNftPort` for unit tests: Map state, writes idempotent by `opId`, `mock:` hashes. */
export class InMemoryBadgeNft extends BadgeNftPort {
  private readonly tokens = new Map<string, { owner: AccountId; metadata: Record<string, unknown> }>();

  constructor(private readonly chain: InMemoryChain = new InMemoryChain()) {
    super();
  }

  async mint(input: NftMintInput): Promise<NftMintResult> {
    this.assertCollection(input.collection);
    assertPlainJsonMetadata(input.metadata);
    const { value, receipt } = this.chain.write(input.opId, () => {
      const tokenId = input.tokenId ?? `${COLLECTION}-${createHash('sha256').update(`nft:${input.opId}`).digest('hex').slice(0, 16)}`;
      if (this.tokens.has(tokenId)) throw new NearException('NEAR_NFT_EXISTS', { details: { collection: COLLECTION, tokenId } });
      this.tokens.set(tokenId, { owner: input.ownerAccountId, metadata: input.metadata });
      return tokenId;
    });
    return { tokenId: value, receipt };
  }

  async updateMetadata(input: NftUpdateMetadataInput): Promise<ChainReceipt> {
    this.assertCollection(input.collection);
    assertPlainJsonMetadata(input.metadata);
    return this.chain.write(input.opId, () => {
      const token = this.tokens.get(input.tokenId);
      if (!token) throw new NearException('NEAR_NFT_NOT_FOUND', { details: { collection: COLLECTION, tokenId: input.tokenId } });
      token.metadata = input.metadata;
    }).receipt;
  }

  async ownerOf(input: NftTokenRef): Promise<AccountId | null> {
    this.assertCollection(input.collection);
    return this.tokens.get(input.tokenId)?.owner ?? null;
  }

  private assertCollection(collection: string): void {
    if (collection !== COLLECTION) throw new NearException('NEAR_NFT_INVALID', { message: `this fake serves collection "${COLLECTION}", got "${collection}"` });
  }
}
