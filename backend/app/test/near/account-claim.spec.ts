import { describe, expect, it } from 'vitest';
import { FlagsService } from '../../src/flags/flags.service';
import { MockIdentityAdapter } from '../../src/near/infrastructure/adapters/identity/mock-identity.adapter';
import { MOCK_HASH_RE } from '../../src/near/infrastructure/mock/tx-hash';
import { AccountClaimController } from '../../src/near/staking/account-claim.controller';
import { AccountClaimService } from '../../src/near/staking/account-claim.service';

function makeFlags(waves: string): FlagsService {
  return new FlagsService({ NODE_ENV: 'test', TA_WAVES: waves } as never);
}

describe('W20-19 AccountClaimService & MockIdentityAdapter unit', () => {
  it('claims a colony account in mock mode, marks it claimed in memory, and is idempotent by opId', async () => {
    const identity = new MockIdentityAdapter({ NODE_ENV: 'test' } as never);
    const service = new AccountClaimService(makeFlags('..20'), identity, { NODE_ENV: 'test' } as never);

    const before = await service.isAccountClaimed('col_0');
    expect(before.claimed).toBe(false);
    expect(before.claimedAt).toBeNull();
    expect(before.claimedByAccountId).toBeNull();

    const first = await service.claimColonyAccount({
      colonyId: 'col_0',
      walletAccountId: 'pilot-wallet.terraagent.mock',
      newPublicKey: 'ed25519:wallet-key-1',
    });
    expect(first.colonyId).toBe('col_0');
    expect(first.accountId).toBe('col_0.pilot.terraagent.mock');
    expect(first.claimedByAccountId).toBe('pilot-wallet.terraagent.mock');
    expect(first.txHash).toMatch(MOCK_HASH_RE);
    expect(Number.isNaN(Date.parse(first.claimedAt))).toBe(false);

    const second = await service.claimColonyAccount({
      colonyId: 'col_0',
      walletAccountId: 'pilot-wallet.terraagent.mock',
      newPublicKey: 'ed25519:wallet-key-1',
    });
    expect(second.txHash).toBe(first.txHash);
    expect(second.claimedAt).toBe(first.claimedAt);

    const afterByColony = await service.isAccountClaimed('col_0');
    expect(afterByColony.claimed).toBe(true);
    expect(afterByColony.accountId).toBe(first.accountId);
    expect(afterByColony.claimedByAccountId).toBe('pilot-wallet.terraagent.mock');

    const afterByAccount = await service.isAccountClaimed('other', first.accountId);
    expect(afterByAccount.claimed).toBe(true);
    expect(afterByAccount.accountId).toBe(first.accountId);
  });

  it('defaults colonyId to col_0 and derives walletAccountId when omitted', async () => {
    const identity = new MockIdentityAdapter({ NODE_ENV: 'test' } as never);
    const service = new AccountClaimService(makeFlags('..20'), identity, { NODE_ENV: 'test' } as never);
    const controller = new AccountClaimController(service, makeFlags('..20'));

    const res = await controller.claimAccount({});
    expect(res.colonyId).toBe('col_0');
    expect(res.claimedByAccountId).toBe('col_0-wallet.terraagent.mock');
    expect(res.txHash).toMatch(MOCK_HASH_RE);
  });

  it('throws 404 NOT_FOUND when W20 wave flag is disabled', async () => {
    const identity = new MockIdentityAdapter({ NODE_ENV: 'test' } as never);
    const service = new AccountClaimService(makeFlags('..19'), identity, { NODE_ENV: 'test' } as never);
    const controller = new AccountClaimController(service, makeFlags('..19'));

    await expect(service.claimColonyAccount({ colonyId: 'col_0' })).rejects.toMatchObject({
      errorCode: 'NOT_FOUND',
      status: 404,
    });
    expect(() => controller.claimAccount({ colonyId: 'col_0' })).toThrow();
  });

  it('preserves NEAR_UNAVAILABLE on MockIdentityAdapter.claimAccount for non-colony claim:test-pilot', async () => {
    const identity = new MockIdentityAdapter({ NODE_ENV: 'test' } as never);
    await expect(
      identity.claimAccount({
        opId: 'claim:test-pilot',
        accountId: 'test-pilot.terraagent.mock',
        walletAccountId: 'alice.near',
        walletPublicKey: 'ed25519:mock',
      }),
    ).rejects.toMatchObject({ errorCode: 'NEAR_UNAVAILABLE' });
  });
});
