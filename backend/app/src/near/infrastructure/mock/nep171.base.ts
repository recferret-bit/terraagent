import { createHash } from 'node:crypto';
import type { DbClient } from '@terra/db';
import { NearException } from '../../domain/errors';
import type { AccountId, ChainReceipt, NftMintInput, NftMintResult, NftTokenRef, NftUpdateMetadataInput } from '../../domain/types';
import { MockChainBase } from './mock-chain.base';

/** Largest accepted metadata document (serialized JSON, UTF-8 bytes). */
export const NFT_METADATA_MAX_BYTES = 16 * 1024;

/** Metadata must survive a JSON round trip unchanged: no undefined, NaN, functions, class instances, cycles. */
export function assertPlainJsonMetadata(metadata: unknown): void {
  const bad = (why: string) => new NearException('NEAR_NFT_INVALID', { message: `NFT metadata ${why}` });
  let text: string | undefined;
  try { text = JSON.stringify(metadata); } catch { throw bad('is not serializable JSON'); }
  if (text === undefined || !isPlain(metadata)) throw bad('must be plain JSON (objects, arrays, strings, finite numbers, booleans, null)');
  if (Buffer.byteLength(text) > NFT_METADATA_MAX_BYTES) throw bad(`exceeds ${NFT_METADATA_MAX_BYTES} bytes`);
}

function isPlain(v: unknown): boolean {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(isPlain);
  if (typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return false;
  return Object.values(v).every(isPlain);
}

const isUniqueConflict = (e: unknown): boolean => (e as { code?: string } | null)?.code === 'P2002';

/**
 * Shared NEP-171 mock (NEAR §1a rule 4): NFT state in `chain.mock_chain_nft`, every metadata change appended to
 * `chain.mock_chain_nft_meta_history`, writes idempotent by `opId` (receipt table and `mock_chain_nft.op_id` are both unique).
 *
 * Reuse: extend it, set `collection` and `portName`, and expose the port methods (they are already `mint`, `updateMetadata`,
 * `ownerOf`, so a subclass that `implements`/extends the matching port needs no body). `MockBadgeNftAdapter` is the example;
 * the deed mock builds on this class too. Add domain rules in an override that calls `super`.
 */
export abstract class BaseNep171MockAdapter extends MockChainBase {
  /** Collection this adapter owns; inputs naming another collection are rejected. */
  protected abstract readonly collection: string;
  /** Port name stored on receipts, e.g. `BadgeNft`. */
  protected abstract readonly portName: string;

  /** Deterministic token id for a mint without an explicit one. */
  protected tokenIdFor(opId: string): string {
    return `${this.collection}-${createHash('sha256').update(`nft:${opId}`).digest('hex').slice(0, 16)}`;
  }

  async mint(input: NftMintInput): Promise<NftMintResult> {
    this.assertCollection(input.collection);
    assertPlainJsonMetadata(input.metadata);
    const tokenId = input.tokenId ?? this.tokenIdFor(input.opId);
    const { value, receipt } = await this.retryOnConflict(() =>
      this.callWithResult(this.portName, 'mint', input.opId, async (tx) => {
        if (await tx.mockChainNft.findUnique({ where: { collection_tokenId: { collection: this.collection, tokenId } } })) {
          throw new NearException('NEAR_NFT_EXISTS', { details: { collection: this.collection, tokenId } });
        }
        await this.ensureAccount(tx, input.ownerAccountId);
        await tx.mockChainNft.create({ data: { collection: this.collection, tokenId, ownerAccountId: input.ownerAccountId, metadata: input.metadata as object, opId: input.opId } });
        await this.appendHistory(tx, tokenId, input.metadata, input.opId);
        return { tokenId };
      }));
    return { tokenId: value.tokenId, receipt };
  }

  async updateMetadata(input: NftUpdateMetadataInput): Promise<ChainReceipt> {
    this.assertCollection(input.collection);
    assertPlainJsonMetadata(input.metadata);
    const { receipt } = await this.retryOnConflict(() =>
      this.callWithResult(this.portName, 'updateMetadata', input.opId, async (tx) => {
        const key = { collection_tokenId: { collection: this.collection, tokenId: input.tokenId } };
        if (!(await tx.mockChainNft.findUnique({ where: key }))) throw this.notFound(input.tokenId);
        await tx.mockChainNft.update({ where: key, data: { metadata: input.metadata as object, updatedAt: new Date() } });
        await this.appendHistory(tx, input.tokenId, input.metadata, input.opId);
        return { tokenId: input.tokenId };
      }));
    return receipt;
  }

  async ownerOf(input: NftTokenRef): Promise<AccountId | null> {
    this.assertCollection(input.collection);
    const row = await this.prisma.mockChainNft.findUnique({ where: { collection_tokenId: { collection: this.collection, tokenId: input.tokenId } } });
    return row?.ownerAccountId ?? null;
  }

  private appendHistory(tx: DbClient, tokenId: string, metadata: object, opId: string) {
    return tx.mockChainNftMetaHistory.create({ data: { collection: this.collection, tokenId, metadata, opId } });
  }

  private notFound(tokenId: string): NearException {
    return new NearException('NEAR_NFT_NOT_FOUND', { details: { collection: this.collection, tokenId } });
  }

  private assertCollection(collection: string): void {
    if (collection !== this.collection) {
      throw new NearException('NEAR_NFT_INVALID', { message: `this adapter serves collection "${this.collection}", got "${collection}"` });
    }
  }

  /**
   * Two concurrent calls with one `opId` both pass the "receipt exists" check; the loser either hits a unique constraint or sees the winner's row (`NEAR_NFT_EXISTS`).
   * Re-running once then finds the winner's receipt and replays it (or, for a racing different `opId`, throws `NEAR_NFT_EXISTS`).
   */
  private async retryOnConflict<T>(run: () => Promise<T>): Promise<T> {
    try { return await run(); } catch (e) {
      if (!isUniqueConflict(e) && (e as { errorCode?: string }).errorCode !== 'NEAR_NFT_EXISTS') throw e;
      return run();
    }
  }
}
