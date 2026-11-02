import { describe, expect, it } from 'vitest';
import { mergeExplorerAccounts } from '../../src/near/infrastructure/dev/explorer-accounts';
import { toExplorerTx } from '../../src/near/infrastructure/dev/explorer-tx';

describe('toExplorerTx', () => {
  it('maps a stored success receipt to FINAL with signer, receiver and hash', () => {
    const view = toExplorerTx({
      status: 'success',
      payload: { signerId: 'alice.test', receiverId: 'res.terraagent.mock' },
      txHash: 'mock:abc',
    });
    expect(view).toMatchObject({
      statusLabel: 'FINAL',
      signerId: 'alice.test',
      receiverId: 'res.terraagent.mock',
      txHash: 'mock:abc',
    });
    expect(view.status).toBe('success');
  });

  it('keeps a non-success status and null ids when the payload has none', () => {
    const view = toExplorerTx({ status: 'failure', payload: { ping: true }, txHash: 'mock:nope' });
    expect(view.statusLabel).toBe('failure');
    expect(view.status).toBe('failure');
    expect(view.signerId).toBeNull();
    expect(view.receiverId).toBeNull();
  });
});

describe('mergeExplorerAccounts', () => {
  it('dedupes mock and near rows and lets the mock kind win', () => {
    const rows = mergeExplorerAccounts(
      [
        { accountId: 'only-mock.terraagent.mock', kind: 'colony', publicKey: 'ed25519:mock' },
        { accountId: 'shared.terraagent.mock', kind: 'named', publicKey: null },
        { accountId: 'both-key.terraagent.mock', kind: 'colony', publicKey: 'ed25519:from-mock' },
      ],
      [
        {
          accountId: 'pilot.terraagent.mock',
          slot: 'player',
          publicKey: 'ed25519:pilot',
          ownerAccountId: 'pilot.terraagent.mock',
        },
        {
          accountId: 'co.pilot.terraagent.mock',
          slot: 'co_1',
          publicKey: 'ed25519:colony',
          ownerAccountId: 'pilot.terraagent.mock',
        },
        {
          accountId: 'shared.terraagent.mock',
          slot: 'co_9',
          publicKey: 'ed25519:shared',
          ownerAccountId: 'pilot.terraagent.mock',
        },
        {
          accountId: 'both-key.terraagent.mock',
          slot: 'player',
          publicKey: 'ed25519:from-near',
          ownerAccountId: 'pilot.terraagent.mock',
        },
      ],
    );
    expect(rows).toEqual([
      {
        accountId: 'both-key.terraagent.mock',
        kind: 'colony',
        publicKey: 'ed25519:from-mock',
        ownerAccountId: 'pilot.terraagent.mock',
      },
      {
        accountId: 'co.pilot.terraagent.mock',
        kind: 'colony',
        publicKey: 'ed25519:colony',
        ownerAccountId: 'pilot.terraagent.mock',
      },
      { accountId: 'only-mock.terraagent.mock', kind: 'colony', publicKey: 'ed25519:mock', ownerAccountId: null },
      {
        accountId: 'pilot.terraagent.mock',
        kind: 'named',
        publicKey: 'ed25519:pilot',
        ownerAccountId: 'pilot.terraagent.mock',
      },
      {
        accountId: 'shared.terraagent.mock',
        kind: 'named',
        publicKey: 'ed25519:shared',
        ownerAccountId: 'pilot.terraagent.mock',
      },
    ]);
  });
});
