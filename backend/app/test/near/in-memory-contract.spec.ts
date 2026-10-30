import { describe, expect, it } from 'vitest';
import { contract as badge } from '../../src/near/__contract__/badge-nft.contract';
import { contract as chainRead } from '../../src/near/__contract__/chain-read.contract';
import { adapterFor } from '../../src/near/__contract__/harness';
import { NearException } from '../../src/near/domain/errors';
import { InMemoryBadgeNft, InMemoryCargoToken, InMemoryChainRead } from '../../src/near/testing';
import { MOCK_HASH_RE } from '../../src/near/infrastructure/mock/tx-hash';

// The same suites that `npm run test:contract` runs against the Postgres mocks, here against the in-memory fakes (no database).
chainRead.run('InMemoryChainRead', async (env) => adapterFor(chainRead, new InMemoryChainRead(), 'mock')(env));
badge.run('InMemoryBadgeNft', async (env) => adapterFor(badge, new InMemoryBadgeNft(), 'mock')(env));

describe('InMemoryCargoToken', () => {
  const base = { tokenId: 'metals.t1' };
  it('mints, burns and transfers on a ledger, idempotent by opId, with mock: receipts', async () => {
    const t = new InMemoryCargoToken();
    const m = await t.mint({ ...base, opId: 'm1', to: 'alice.near', amount: '100' });
    expect(m.txHash).toMatch(MOCK_HASH_RE);
    expect((await t.mint({ ...base, opId: 'm1', to: 'alice.near', amount: '100' })).txHash).toBe(m.txHash);
    await t.transfer({ ...base, opId: 't1', from: 'alice.near', to: 'bob.near', amount: '30' });
    await t.burn({ ...base, opId: 'b1', from: 'bob.near', amount: '10' });
    expect(await t.balanceOf({ accountId: 'alice.near', tokenId: base.tokenId })).toBe('70');
    expect(await t.balanceOf({ accountId: 'bob.near', tokenId: base.tokenId })).toBe('20');
    expect(await t.balanceOf({ accountId: 'nobody.near', tokenId: base.tokenId })).toBe('0');
  });

  it('fails with NEAR_INSUFFICIENT_BALANCE and changes nothing', async () => {
    const t = new InMemoryCargoToken();
    await t.mint({ ...base, opId: 'm1', to: 'alice.near', amount: '5' });
    const err = await t.transfer({ ...base, opId: 't1', from: 'alice.near', to: 'bob.near', amount: '6' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NearException);
    expect(err).toMatchObject({ errorCode: 'NEAR_INSUFFICIENT_BALANCE' });
    expect(await t.balanceOf({ accountId: 'alice.near', tokenId: base.tokenId })).toBe('5');
    expect(await t.balanceOf({ accountId: 'bob.near', tokenId: base.tokenId })).toBe('0');
    await t.mint({ ...base, opId: 'm2', to: 'alice.near', amount: '1' });
    await t.transfer({ ...base, opId: 't1', from: 'alice.near', to: 'bob.near', amount: '6' }); // same opId after a failure is retried, not replayed
    expect(await t.balanceOf({ accountId: 'bob.near', tokenId: base.tokenId })).toBe('6');
  });
});
