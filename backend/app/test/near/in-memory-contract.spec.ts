import { contract as badge } from '../../src/near/__contract__/badge-nft.contract';
import { contract as cargo } from '../../src/near/__contract__/cargo.contract';
import { contract as chainRead } from '../../src/near/__contract__/chain-read.contract';
import { adapterFor } from '../../src/near/__contract__/harness';
import { InMemoryBadgeNft, InMemoryCargoToken, InMemoryChainRead } from '../../src/near/testing';

// The same suites that `npm run test:contract` runs against the Postgres mocks, here against the in-memory fakes (no database).
chainRead.run('InMemoryChainRead', async (env) => adapterFor(chainRead, new InMemoryChainRead(), 'mock')(env));
badge.run('InMemoryBadgeNft', async (env) => adapterFor(badge, new InMemoryBadgeNft(), 'mock')(env));
cargo.run('InMemoryCargoToken', async (env) => adapterFor(cargo, new InMemoryCargoToken(), 'mock')(env));
