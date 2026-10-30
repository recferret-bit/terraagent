import { expect } from 'vitest';
import type { BadgeNftPort } from '../application/ports/badge-nft.port';
import type { DeedNftPort } from '../application/ports/deed-nft.port';
import type { NearContractSuite } from './harness';

export type NftPortUnderTest = BadgeNftPort | DeedNftPort;
export interface NftHelpers {
  /** The collection this adapter serves (`badge`, `deed`). */
  readonly collection: string;
}

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/**
 * Behaviour every `BadgeNftPort` / `DeedNftPort` adapter must show (NEAR §1a): idempotent mint by `opId`, `NEAR_NFT_EXISTS`,
 * `NEAR_NFT_NOT_FOUND`, owner unchanged by metadata updates. Shared by `badge-nft.contract.ts` and the deed contract.
 */
export const nftSuite: NearContractSuite<NftPortUnderTest, NftHelpers> = ({ test, expectReceipt }) => {
  test('mint twice with the same opId returns the same tokenId and receipt', async (a) => {
    const { port, collection } = a;
    const input = { opId: `mint:${uid()}`, collection, ownerAccountId: 'alice.near', metadata: { name: 'First' } };
    const first = await port.mint(input);
    const second = await port.mint(input);
    expect(second.tokenId).toBe(first.tokenId);
    expect(second.receipt.txHash).toBe(first.receipt.txHash);
    expectReceipt(first.receipt, a);
    expect(await port.ownerOf({ collection, tokenId: first.tokenId })).toBe('alice.near');
  });

  test('a different opId minting an existing tokenId fails with NEAR_NFT_EXISTS', async ({ port, collection }) => {
    const tokenId = `tok-${uid()}`;
    await port.mint({ opId: `mint:${uid()}`, collection, ownerAccountId: 'alice.near', tokenId, metadata: {} });
    await expect(port.mint({ opId: `mint:${uid()}`, collection, ownerAccountId: 'bob.near', tokenId, metadata: {} })).rejects.toMatchObject({ errorCode: 'NEAR_NFT_EXISTS' });
    expect(await port.ownerOf({ collection, tokenId })).toBe('alice.near');
  });

  test('updateMetadata keeps the owner, is idempotent by opId, and fails for unknown tokens', async ({ port, collection }) => {
    const { tokenId } = await port.mint({ opId: `mint:${uid()}`, collection, ownerAccountId: 'alice.near', metadata: { v: 1 } });
    const up = { opId: `upd:${uid()}`, collection, tokenId, metadata: { v: 2 } };
    const r1 = await port.updateMetadata(up);
    expect((await port.updateMetadata(up)).txHash).toBe(r1.txHash);
    expect(await port.ownerOf({ collection, tokenId })).toBe('alice.near');
    await expect(port.updateMetadata({ opId: `upd:${uid()}`, collection, tokenId: 'missing', metadata: {} })).rejects.toMatchObject({ errorCode: 'NEAR_NFT_NOT_FOUND' });
  });

  test('ownerOf is null for a token that does not exist', async ({ port, collection }) => {
    expect(await port.ownerOf({ collection, tokenId: `none-${uid()}` })).toBeNull();
  });
};
