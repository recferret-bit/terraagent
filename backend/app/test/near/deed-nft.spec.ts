import { describe, expect, it } from 'vitest';
import { nearAdapterFor } from '../../src/near/infrastructure/adapter-selection';
import { InMemoryDeedNft } from '../../src/near/testing/in-memory-deed-nft';

describe('W20-03 InMemoryDeedNft & fail-closed adapter selection', () => {
  it('acceptance: NEAR_ADAPTER_DEED=typo fails closed to mock adapter', () => {
    expect(nearAdapterFor('DeedNft', { NEAR_ADAPTER_DEED: 'typo' })).toBe('mock');
    expect(nearAdapterFor('DeedNft', { NEAR_ADAPTER_DEED: '' })).toBe('mock');
    expect(nearAdapterFor('DeedNft', {})).toBe('mock');
    expect(nearAdapterFor('DeedNft', { NEAR_ADAPTER_DEED: 'testnet' })).toBe('testnet');
  });

  it('mints idempotently, increments version monotonically, and enforces one-way settled', async () => {
    const deed = new InMemoryDeedNft();
    const m1 = await deed.mint({
      opId: 'deed-mint:col-0',
      collection: 'deed',
      tokenId: 'deed:col-0',
      ownerAccountId: 'col-0.pilot.terraagent.mock',
      metadata: {
        planet: 'pl_dune_01',
        colony: 'col-0',
        terraformBp: 1000,
        status: 'active',
        settled: false,
        version: 1,
        imageUrl: '/v1/near/deed/deed:col-0/image.png',
      },
    });
    const m2 = await deed.mint({
      opId: 'deed-mint:col-0',
      collection: 'deed',
      tokenId: 'deed:col-0',
      ownerAccountId: 'col-0.pilot.terraagent.mock',
      metadata: {
        planet: 'pl_dune_01',
        colony: 'col-0',
        terraformBp: 1000,
        status: 'active',
        settled: false,
        version: 1,
        imageUrl: '/v1/near/deed/deed:col-0/image.png',
      },
    });
    expect(m1.tokenId).toBe('deed:col-0');
    expect(m2.receipt.txHash).toBe(m1.receipt.txHash);
    expect(await deed.ownerOf({ collection: 'deed', tokenId: 'deed:col-0' })).toBe('col-0.pilot.terraagent.mock');

    await deed.updateMetadata({
      opId: 'deed-meta:col-0:2',
      collection: 'deed',
      tokenId: 'deed:col-0',
      metadata: { terraformBp: 4000 },
    });
    const afterUpdate = await deed.get('deed:col-0');
    expect(afterUpdate?.version).toBe(2);
    expect(afterUpdate?.settled).toBe(false);
    expect(afterUpdate?.metadata.terraformBp).toBe(4000);
    expect(afterUpdate?.history).toHaveLength(2);

    // Settle the deed (settled: true)
    await deed.updateMetadata({
      opId: 'deed-settle:col-0',
      collection: 'deed',
      tokenId: 'deed:col-0',
      metadata: { settled: true, status: 'settled', terraformBp: 10_000 },
    });
    const afterSettle = await deed.get({ collection: 'deed', tokenId: 'deed:col-0' });
    expect(afterSettle?.version).toBe(3);
    expect(afterSettle?.settled).toBe(true);
    expect(afterSettle?.metadata.status).toBe('settled');

    // Attempting to unsettle (settled: false) is rejected (one-way)
    await expect(
      deed.updateMetadata({
        opId: 'deed-meta:col-0:4',
        collection: 'deed',
        tokenId: 'deed:col-0',
        metadata: { settled: false, status: 'active' },
      }),
    ).rejects.toMatchObject({ errorCode: 'NEAR_NFT_INVALID' });
  });
});

describe('W20-03 InMemoryDeedNft negative & corner cases', () => {
  it('rejects wrong collection, duplicate tokenId with new opId, and missing token on updateMetadata', async () => {
    const deed = new InMemoryDeedNft();
    await expect(
      deed.mint({
        opId: 'deed-bad-col',
        collection: 'badge',
        ownerAccountId: 'a.near',
        metadata: {},
      }),
    ).rejects.toMatchObject({ errorCode: 'NEAR_NFT_INVALID' });

    await expect(
      deed.updateMetadata({
        opId: 'deed-missing',
        collection: 'deed',
        tokenId: 'deed:nope',
        metadata: { version: 2 },
      }),
    ).rejects.toMatchObject({ errorCode: 'NEAR_NFT_NOT_FOUND' });

    expect(await deed.get('deed:nope')).toBeNull();
  });
});
