import { expect } from 'vitest';
import type { DeedNftPort } from '../application/ports/deed-nft.port';
import {
  defineNearContract,
  describeNearPortContract,
  type MakeAdapter,
  type NearContractApi,
  type NearContractSuite,
} from './harness';
import { nftSuite, type NftHelpers } from './nft.suite';

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

function addGetAndVersionTests(api: NearContractApi<DeedNftPort, NftHelpers>): void {
  const { test, expectReceipt } = api;
  test('get returns null for unknown token and full record with incrementing version and history after updates', async (a) => {
    const { port, collection } = a;
    const tokenId = `deed:${uid()}`;
    expect(await port.get({ collection, tokenId })).toBeNull();
    expect(await port.get(tokenId)).toBeNull();

    const minted = await port.mint({
      opId: `deed-mint:${uid()}`,
      collection,
      tokenId,
      ownerAccountId: 'colony-1.pilot.terraagent.mock',
      metadata: {
        planet: 'pl_dune_01',
        colony: 'col-1',
        stage: 1,
        terraformBp: 1000,
        status: 'active',
        settled: false,
        version: 1,
        imageUrl: `/v1/near/deed/${tokenId}/image.png`,
      },
    });
    expectReceipt(minted.receipt, a);

    const rec1 = await port.get(tokenId);
    expect(rec1).not.toBeNull();
    expect(rec1!.tokenId).toBe(tokenId);
    expect(rec1!.ownerAccountId).toBe('colony-1.pilot.terraagent.mock');
    expect(rec1!.version).toBe(1);
    expect(rec1!.settled).toBe(false);
    expect(rec1!.history.length).toBeGreaterThanOrEqual(1);

    const updReceipt = await port.updateMetadata({
      opId: `deed-meta:${uid()}`,
      collection,
      tokenId,
      metadata: { stage: 3, terraformBp: 4000 },
    });
    expectReceipt(updReceipt, a);

    const rec2 = await port.get({ collection, tokenId });
    expect(rec2!.version).toBe(2);
    expect(rec2!.settled).toBe(false);
    expect(rec2!.metadata.terraformBp).toBe(4000);
    expect(rec2!.history.length).toBeGreaterThanOrEqual(2);
  });
}

function addSettledAndValidationTests(api: NearContractApi<DeedNftPort, NftHelpers>): void {
  const { test, expectReceipt } = api;
  test('settled is one-way: once settled is true, attempting to unsettle fails with NEAR_NFT_INVALID', async (a) => {
    const { port, collection } = a;
    const tokenId = `deed:${uid()}`;
    await port.mint({
      opId: `deed-mint:${uid()}`,
      collection,
      tokenId,
      ownerAccountId: 'colony-2.pilot.terraagent.mock',
      metadata: {
        planet: 'pl_dune_01',
        colony: 'col-2',
        status: 'active',
        settled: false,
        version: 1,
        imageUrl: `/v1/near/deed/${tokenId}/image.png`,
      },
    });

    const settleReceipt = await port.updateMetadata({
      opId: `deed-settle:${uid()}`,
      collection,
      tokenId,
      metadata: { settled: true, status: 'settled', terraformBp: 10_000 },
    });
    expectReceipt(settleReceipt, a);

    const settledRec = await port.get(tokenId);
    expect(settledRec!.settled).toBe(true);
    expect(settledRec!.metadata.status).toBe('settled');
    expect(settledRec!.version).toBe(2);

    await expect(
      port.updateMetadata({
        opId: `deed-unsettle:${uid()}`,
        collection,
        tokenId,
        metadata: { settled: false, status: 'active' },
      }),
    ).rejects.toMatchObject({ errorCode: 'NEAR_NFT_INVALID' });

    const stillSettled = await port.get(tokenId);
    expect(stillSettled!.settled).toBe(true);
    expect(stillSettled!.version).toBe(2);
  });

  test('rejects wrong collection or non-JSON metadata with NEAR_NFT_INVALID', async ({ port }) => {
    await expect(
      port.mint({
        opId: `deed-bad-col:${uid()}`,
        collection: 'badge',
        ownerAccountId: 'alice.near',
        metadata: {},
      }),
    ).rejects.toMatchObject({ errorCode: 'NEAR_NFT_INVALID' });

    await expect(
      port.mint({
        opId: `deed-bad-json:${uid()}`,
        collection: 'deed',
        ownerAccountId: 'alice.near',
        metadata: { bad: Number.NaN },
      }),
    ).rejects.toMatchObject({ errorCode: 'NEAR_NFT_INVALID' });
  });
}

export const deedSuite: NearContractSuite<DeedNftPort, NftHelpers> = (api) => {
  nftSuite(api);
  addGetAndVersionTests(api);
  addSettledAndValidationTests(api);
};

export const contract = defineNearContract<DeedNftPort, NftHelpers>({
  port: 'DeedNft',
  helpers: () => ({ collection: 'deed' }),
  suite: deedSuite,
});

export const describeDeedNftPortContract = (
  label: string,
  make: MakeAdapter<DeedNftPort, NftHelpers>,
): void => describeNearPortContract('DeedNft', label, make, deedSuite);
