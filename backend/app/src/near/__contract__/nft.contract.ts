import { describe, expect, it } from 'vitest';
import { MOCK_HASH_RE } from '../infrastructure/mock/tx-hash';
import type { BadgeNftPort } from '../application/ports/badge-nft.port';
import type { DeedNftPort } from '../application/ports/deed-nft.port';

export type NftPortUnderTest = BadgeNftPort | DeedNftPort;
export interface NftContractTarget {
  readonly port: NftPortUnderTest;
  readonly collection: string;
  /** Only mock adapters return `mock:` hashes; real ones skip that assertion. */
  readonly mock?: boolean;
}

/**
 * Behaviour every `BadgeNftPort` / `DeedNftPort` adapter must show (NEAR §1a): idempotent mint by `opId`, `NEAR_NFT_EXISTS`,
 * `NEAR_NFT_NOT_FOUND`, owner unchanged by metadata updates. `makeAdapter` is called once per test.
 * A later generic `describeNearPortContract` harness adopts this.
 */
export function describeNftPortContract(name: string, makeAdapter: () => NftContractTarget | Promise<NftContractTarget>): void {
  const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  describe(`${name} NFT port contract`, () => {
    it('mint twice with the same opId returns the same tokenId and receipt', async () => {
      const { port, collection, mock } = await makeAdapter();
      const input = { opId: `mint:${uid()}`, collection, ownerAccountId: 'alice.near', metadata: { name: 'First' } };
      const a = await port.mint(input);
      const b = await port.mint(input);
      expect(b.tokenId).toBe(a.tokenId);
      expect(b.receipt.txHash).toBe(a.receipt.txHash);
      if (mock) expect(a.receipt.txHash).toMatch(MOCK_HASH_RE);
      expect(await port.ownerOf({ collection, tokenId: a.tokenId })).toBe('alice.near');
    });

    it('a different opId minting an existing tokenId fails with NEAR_NFT_EXISTS', async () => {
      const { port, collection } = await makeAdapter();
      const tokenId = `tok-${uid()}`;
      await port.mint({ opId: `mint:${uid()}`, collection, ownerAccountId: 'alice.near', tokenId, metadata: {} });
      await expect(port.mint({ opId: `mint:${uid()}`, collection, ownerAccountId: 'bob.near', tokenId, metadata: {} })).rejects.toMatchObject({ errorCode: 'NEAR_NFT_EXISTS' });
      expect(await port.ownerOf({ collection, tokenId })).toBe('alice.near');
    });

    it('updateMetadata keeps the owner, is idempotent by opId, and fails for unknown tokens', async () => {
      const { port, collection } = await makeAdapter();
      const { tokenId } = await port.mint({ opId: `mint:${uid()}`, collection, ownerAccountId: 'alice.near', metadata: { v: 1 } });
      const up = { opId: `upd:${uid()}`, collection, tokenId, metadata: { v: 2 } };
      const r1 = await port.updateMetadata(up);
      expect((await port.updateMetadata(up)).txHash).toBe(r1.txHash);
      expect(await port.ownerOf({ collection, tokenId })).toBe('alice.near');
      await expect(port.updateMetadata({ opId: `upd:${uid()}`, collection, tokenId: 'missing', metadata: {} })).rejects.toMatchObject({ errorCode: 'NEAR_NFT_NOT_FOUND' });
    });

    it('ownerOf is null for a token that does not exist', async () => {
      const { port, collection } = await makeAdapter();
      expect(await port.ownerOf({ collection, tokenId: `none-${uid()}` })).toBeNull();
    });
  });
}
