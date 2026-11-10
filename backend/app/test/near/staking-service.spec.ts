import { describe, expect, it } from 'vitest';
import { deedMintOpId, deedTokenId, type DeedMetadataV1 } from '@terra/contracts';
import type { AppEnv } from '../../src/core/tokens';
import { FlagsService } from '../../src/flags/flags.service';
import { DeedRepository } from '../../src/near/deed/deed.repository';
import { MockIdentityAdapter } from '../../src/near/infrastructure/adapters/identity/mock-identity.adapter';
import { MOCK_HASH_RE } from '../../src/near/infrastructure/mock/tx-hash';
import { AccountClaimService } from '../../src/near/staking/account-claim.service';
import { StakingPositionSyncService } from '../../src/near/staking/staking-position-sync.service';
import { StakingController } from '../../src/near/staking/staking.controller';
import { StakingService } from '../../src/near/staking/staking.service';
import { InMemoryStaking } from '../../src/near/testing/in-memory-staking';

const POOL_ASTRO = 'astro-stakers.pool.mock';

function createHarness(waves = '..20') {
  const env = { NODE_ENV: 'test', TA_WAVES: waves } as unknown as AppEnv;
  const flags = new FlagsService(env);
  const stakingPort = new InMemoryStaking();
  const deeds = new DeedRepository(env);
  const identity = new MockIdentityAdapter(env as never);
  const claimService = new AccountClaimService(flags, identity, env);
  const positionSync = new StakingPositionSyncService(stakingPort, env, undefined, flags);
  const service = new StakingService(
    flags,
    stakingPort,
    deeds,
    claimService,
    positionSync,
    undefined,
    env,
  );
  const controller = new StakingController(service, flags);
  return { env, flags, stakingPort, deeds, claimService, positionSync, service, controller };
}

async function seedDeed(
  deeds: DeedRepository,
  opts: { colonyId?: string; accountId?: string; settled?: boolean } = {},
) {
  const colonyId = opts.colonyId ?? 'col_0';
  const accountId = opts.accountId ?? `${colonyId}.pilot.terraagent.mock`;
  const settled = opts.settled ?? false;
  const metadata: DeedMetadataV1 = {
    planet: 'pl_dune_01',
    colony: colonyId,
    stage: 4,
    terraformBp: settled ? 10_000 : 4_000,
    status: settled ? 'settled' : 'active',
    settled,
    version: 1,
    imageUrl: `/v1/near/deed/${encodeURIComponent(deedTokenId(colonyId))}/image.png?v=1`,
  };
  const { record } = await deeds.upsertInitialMint({
    colonyId,
    planetId: 'pl_dune_01',
    playerId: 'p_pilot',
    accountId,
    tokenId: deedTokenId(colonyId),
    metadata,
    opId: deedMintOpId(colonyId),
  });
  return record;
}

describe('W20-18 StakingService negative rules — deed & claim preconditions', () => {
  it('rejects stake on a non-existent deed with DEED_NOT_FOUND (404)', async () => {
    const { service } = createHarness();
    await expect(
      service.stake({ colonyId: 'col_missing', pool: POOL_ASTRO, amount: '5' }),
    ).rejects.toMatchObject({
      errorCode: 'DEED_NOT_FOUND',
      status: 404,
    });
  });

  it('rejects stake on an unsettled deed with DEED_NOT_SETTLED (409)', async () => {
    const { deeds, service } = createHarness();
    await seedDeed(deeds, { colonyId: 'col_0', settled: false });

    await expect(
      service.stake({ colonyId: 'col_0', pool: POOL_ASTRO, amount: '5' }),
    ).rejects.toMatchObject({
      errorCode: 'DEED_NOT_SETTLED',
      status: 409,
      details: { colonyId: 'col_0', settled: false },
    });
  });

  it('rejects stake on a settled deed with an unclaimed account with ACCOUNT_NOT_CLAIMED (409) and claimUrl', async () => {
    const { deeds, service } = createHarness();
    await seedDeed(deeds, { colonyId: 'col_0', settled: true });

    await expect(
      service.stake({ colonyId: 'col_0', pool: POOL_ASTRO, amount: '5' }),
    ).rejects.toMatchObject({
      errorCode: 'ACCOUNT_NOT_CLAIMED',
      status: 409,
      details: {
        colonyId: 'col_0',
        accountId: 'col_0.pilot.terraagent.mock',
        claimUrl: '/v1/near/claim-account',
      },
    });
  });

  it('rejects non-whitelisted pool (POOL_NOT_WHITELISTED) and insufficient balance (STAKE_INSUFFICIENT_BALANCE)', async () => {
    const { deeds, claimService, service } = createHarness();
    await seedDeed(deeds, { colonyId: 'col_0', settled: true });
    await claimService.claimColonyAccount({
      colonyId: 'col_0',
      walletAccountId: 'pilot-wallet.terraagent.mock',
    });

    await expect(
      service.stake({ colonyId: 'col_0', pool: 'rogue-validator.pool.mock', amount: '1' }),
    ).rejects.toMatchObject({ errorCode: 'POOL_NOT_WHITELISTED', status: 422 });

    await service.fundWalletNear('col_0.pilot.terraagent.mock', '3');
    await expect(
      service.stake({ colonyId: 'col_0', pool: POOL_ASTRO, amount: '5' }),
    ).rejects.toMatchObject({ errorCode: 'STAKE_INSUFFICIENT_BALANCE', status: 409 });
  });
});

describe('W20-18 StakingService & StakingController lifecycle and wave gating', () => {
  it('completes happy-path stake -> unstake -> withdraw on settled deed + claimed account + funded wallet', async () => {
    const { deeds, claimService, service, controller } = createHarness();
    await seedDeed(deeds, { colonyId: 'col_0', settled: true });
    await claimService.claimColonyAccount({
      colonyId: 'col_0',
      walletAccountId: 'pilot-wallet.terraagent.mock',
    });

    const funded = await service.fundWalletNear('col_0.pilot.terraagent.mock', '10');
    expect(funded.walletBalanceNear).toBe('10');

    const initialStatus = await controller.getStatus('col_0');
    expect(initialStatus.deedSettled).toBe(true);
    expect(initialStatus.accountClaimed).toBe(true);
    expect(initialStatus.claimedByAccountId).toBe('pilot-wallet.terraagent.mock');
    expect(initialStatus.walletBalanceNear).toBe('10');
    expect(initialStatus.pools.length).toBeGreaterThanOrEqual(2);
    expect(initialStatus.positions).toEqual([]);

    const staked = await controller.stake({ colonyId: 'col_0', pool: POOL_ASTRO, amount: '6' });
    expect(staked.txHash).toMatch(MOCK_HASH_RE);
    expect(staked.walletBalanceNear).toBe('4');
    expect(staked.position).toMatchObject({
      colonyId: 'col_0',
      accountId: 'col_0.pilot.terraagent.mock',
      pool: POOL_ASTRO,
      staked: '6',
      unbonding: '0',
      withdrawable: '0',
    });

    service.advanceGameDays(30);
    const unstaked = await controller.unstake({ colonyId: 'col_0', pool: POOL_ASTRO, amount: '6' });
    expect(unstaked.txHash).toMatch(MOCK_HASH_RE);
    expect(unstaked.position.staked).toBe('0');
    expect(unstaked.position.unbonding).toBe('6');
    expect(unstaked.position.unbondingReadyAtMs).not.toBeNull();
    expect(Number(unstaked.position.rewards)).toBeGreaterThan(0);

    service.advanceGameDays(2);
    const withdrawn = await controller.withdraw({ colonyId: 'col_0', pool: POOL_ASTRO });
    expect(withdrawn.txHash).toMatch(MOCK_HASH_RE);
    expect(withdrawn.position.staked).toBe('0');
    expect(withdrawn.position.unbonding).toBe('0');
    expect(withdrawn.position.withdrawable).toBe('0');
    expect(Number(withdrawn.walletBalanceNear)).toBeGreaterThan(10);

    const finalStatus = await controller.getStatus('col_0');
    expect(finalStatus.positions).toEqual([]);
    expect(Number(finalStatus.walletBalanceNear)).toBeGreaterThan(10);
  });

  it('rejects malformed controller payloads (400) and returns 404 when wave W20 is disabled', async () => {
    const { controller } = createHarness('..20');
    expect(() => controller.stake({ pool: POOL_ASTRO, amount: '-5' })).toThrow();
    expect(() => controller.unstake({ pool: POOL_ASTRO, amount: 'abc' })).toThrow();
    expect(() => controller.withdraw({ pool: POOL_ASTRO, strayField: true })).toThrow();

    const { service: offService, controller: offController } = createHarness('..19');
    await expect(offService.getStatus({ colonyId: 'col_0' })).rejects.toMatchObject({
      errorCode: 'NOT_FOUND',
      status: 404,
    });
    expect(() => offController.getStatus('col_0')).toThrow();
    expect(() => offController.stake({ pool: POOL_ASTRO, amount: '1' })).toThrow();
  });
});
