import type { BadgeNftPort } from '../application/ports/badge-nft.port';
import { defineNearContract, describeNearPortContract, type MakeAdapter } from './harness';
import { nftSuite, type NftHelpers } from './nft.suite';

/** Port contract for `BadgeNftPort` (collection `badge`). */
export const contract = defineNearContract<BadgeNftPort, NftHelpers>({
  port: 'BadgeNft',
  helpers: () => ({ collection: 'badge' }),
  suite: nftSuite,
});

/** Runs the NFT suite for any adapter that implements the NFT shape, whatever its collection (used to prove base reuse). */
export const describeNftPortContract = (label: string, make: MakeAdapter<BadgeNftPort, NftHelpers>): void =>
  describeNearPortContract('BadgeNft', label, make, nftSuite);
