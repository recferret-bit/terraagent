import { createHash } from 'node:crypto';
import type { PrismaClient } from '@terra/db';
import { describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../../src/core/tokens.js';
import { FlagsService } from '../../src/flags/flags.service.js';
import type { IdentityPort } from '../../src/near/application/ports/identity.port.js';
import type { StakingPort } from '../../src/near/application/ports/staking.port.js';
import type { DeedRepository, StoredDeedRecord } from '../../src/near/deed/deed.repository.js';
import { NearException } from '../../src/near/domain/errors.js';
import { deriveAccountName, isReservedAccountName } from '../../src/near/identity/account-name.js';
import { colonyAccountCandidates } from '../../src/near/identity/colony-account-id.js';
import { accountRootFromOwner } from '../../src/near/identity/colony-account-write.js';
import { MockIntentsAdapter } from '../../src/near/infrastructure/adapters/mock/intents.adapter.js';
import {
  buildMainnetSaltNonce,
  normalizeMainnetDeltas,
} from '../../src/near/infrastructure/adapters/real/mainnet-intents-rpc.js';
import { TestnetIdentityAdapter } from '../../src/near/infrastructure/adapters/real/testnet-identity.adapter.js';
import { resolveNearNetworkConfig } from '../../src/near/infrastructure/network/near-network.config.js';
import { toNearException } from '../../src/near/infrastructure/rpc/near-error-map.js';
import type { NearRpcClient } from '../../src/near/infrastructure/rpc/near-rpc.client.js';
import { AccountClaimService } from '../../src/near/staking/account-claim.service.js';
import type { StakingPositionSyncService } from '../../src/near/staking/staking-position-sync.service.js';
import { StakingService } from '../../src/near/staking/staking.service.js';

function makeDbEnv(extra: Record<string, string> = {}): AppEnv {
  return {
    NODE_ENV: 'test',
    TA_PORT_BASE: 3000,
    TA_PG_PORT: 5432,
    TA_DB_NAME: 'terra_test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgresql://terra:terra@localhost:5432/terra_test',
    ...extra,
  } as unknown as AppEnv;
}

describe('AccountClaimService ownership & TestnetIdentityAdapter idempotency', () => {
  it('rejects cross-player claimColonyAccount (NEAR_NOT_OWNER) and allows the owning player', async () => {
    const ownedRow = {
      accountId: 'col-0.alex.pilots.terraagent.testnet',
      playerId: 'player-owner',
      slot: 'col_0',
      colonyId: 'col_0',
      ownerAccountId: 'alex.pilots.terraagent.testnet',
      publicKey: 'ed25519:owner-key',
      encryptedSecret: 'sealed',
      kekVersion: 1,
      claimedAt: null as Date | null,
      claimedByAccountId: null as string | null,
    };
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const fakePrisma = {
      nearColonyAccount: {
        findUnique: vi.fn().mockResolvedValue(ownedRow),
        findFirst: vi.fn().mockResolvedValue(ownedRow),
        updateMany,
      },
    } as unknown as PrismaClient;
    const claimAccount = vi.fn().mockResolvedValue({
      txHash: 'tx-claim-1',
      status: 'success',
      network: 'testnet',
      at: 1_700_000_000_000,
    });
    const identity = { claimAccount } as unknown as IdentityPort;
    const service = new AccountClaimService(
      new FlagsService(makeDbEnv({ TA_WAVES: 'all' })),
      identity,
      makeDbEnv({ NEAR_MODE: 'testnet' }),
      fakePrisma,
    );

    await expect(
      service.claimColonyAccount({
        colonyId: 'col_0',
        walletAccountId: 'mallory.testnet',
        newPublicKey: 'ed25519:mallory-key',
        playerId: 'player-attacker',
      }),
    ).rejects.toMatchObject({ errorCode: 'NEAR_NOT_OWNER' });
    expect(claimAccount).not.toHaveBeenCalled();

    await expect(
      service.claimColonyAccount({
        colonyId: 'col_0',
        walletAccountId: 'alex.testnet',
        newPublicKey: 'ed25519:alex-key',
      }),
    ).rejects.toMatchObject({ errorCode: 'NEAR_NOT_OWNER' });

    const ok = await service.claimColonyAccount({
      colonyId: 'col_0',
      walletAccountId: 'alex.testnet',
      newPublicKey: 'ed25519:alex-key',
      playerId: 'player-owner',
    });
    expect(ok.accountId).toBe(ownedRow.accountId);
    expect(ok.claimedByAccountId).toBe('alex.testnet');
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it('replays TestnetIdentityAdapter.claimAccount idempotently for the same wallet and rejects a different wallet', async () => {
    const claimedDate = new Date('2026-11-13T12:00:00.000Z');
    const fakePrisma = {
      nearColonyAccount: {
        findUnique: vi.fn().mockResolvedValue({
          accountId: 'alex.pilots.terraagent.testnet',
          encryptedSecret: 'claimed',
          claimedByAccountId: 'alex.testnet',
          claimedAt: claimedDate,
        }),
      },
    } as unknown as PrismaClient;
    const adapter = new TestnetIdentityAdapter(makeDbEnv({ NEAR_MODE: 'testnet' }), fakePrisma);

    const replay = await adapter.claimAccount({
      opId: 'claim-op-same',
      accountId: 'alex.pilots.terraagent.testnet',
      walletAccountId: 'alex.testnet',
      walletPublicKey: 'ed25519:11111111111111111111111111111111',
    });
    expect(replay.status).toBe('success');
    expect(replay.txHash).toBe('claimed:alex.pilots.terraagent.testnet');

    await expect(
      adapter.claimAccount({
        opId: 'claim-op-other',
        accountId: 'alex.pilots.terraagent.testnet',
        walletAccountId: 'intruder.testnet',
        walletPublicKey: 'ed25519:22222222222222222222222222222222',
      }),
    ).rejects.toMatchObject({ errorCode: 'NEAR_NOT_OWNER' });
  });
});

describe('Post-claim intents guard, Mainnet salt nonces & 4-segment pilot sub-accounts', () => {
  it('fails closed with NEAR_NOT_OWNER when MockIntentsAdapter.signTokenDiff sees encryptedSecret === claimed', async () => {
    const fakePrisma = {
      nearColonyAccount: {
        findUnique: vi.fn().mockResolvedValue({
          accountId: 'col-0.alex.pilots.terraagent.mock',
          publicKey: 'ed25519:claimed-key',
          encryptedSecret: 'claimed',
          kekVersion: 1,
        }),
      },
    } as unknown as PrismaClient;
    const intents = new MockIntentsAdapter(fakePrisma);
    await expect(
      intents.signTokenDiff({
        accountId: 'col-0.alex.pilots.terraagent.mock',
        deltas: { 'nep245:res.terraagent.mock:metals.t1': '-100' },
        deadlineMs: Date.now() + 60_000,
      }),
    ).rejects.toMatchObject({ errorCode: 'NEAR_NOT_OWNER' });
  });

  it('prefixes 4-byte current_salt from intents.near while preserving the deterministic 28-byte seedNonce tail', async () => {
    const seed32 = createHash('sha256').update('trade-42:alice.near').digest();
    const seedNonce = seed32.toString('base64');
    const view = vi.fn().mockResolvedValue('deadbeef');
    const fakeRpc = {
      config: resolveNearNetworkConfig({ NEAR_MODE: 'mainnet', NEAR_ALLOW_MAINNET: '1' }, 'mainnet'),
      view,
    } as unknown as NearRpcClient;

    const first = await buildMainnetSaltNonce(fakeRpc, seedNonce);
    const second = await buildMainnetSaltNonce(fakeRpc, seedNonce);
    expect(first).toBe(second);
    const decoded = Buffer.from(first, 'base64');
    expect(decoded.length).toBe(32);
    expect(decoded.subarray(0, 4).toString('hex')).toBe('deadbeef');
    expect(decoded.subarray(4, 32).equals(seed32.subarray(0, 28))).toBe(true);

    const mapped = normalizeMainnetDeltas(
      { 'nep245:res.terraagent.mock:metals.t1': '500', 'nep141:usdc.mock': '-1000' },
      fakeRpc.config,
    );
    expect(mapped['nep245:res.terraagent.near:metals.t1']).toBe('500');
    expect(mapped[`nep141:${fakeRpc.config.quoteTokens.usdc}`]).toBe('-1000');
  });
});

describe('4-segment pilot sub-accounts & real-network staking signature guard', () => {
  it('resolves 4-segment pilot factory accounts, reserved protocol labels, and NEAR_NAME_TAKEN panics', () => {
    expect(
      accountRootFromOwner('alex.pilots.terraagent.testnet', 'col_0', { NEAR_MODE: 'testnet' }),
    ).toBe('pilots.terraagent.testnet');
    expect(
      accountRootFromOwner('alex.pilots.terraagent.near', 'col_0', { NEAR_MODE: 'mainnet' }),
    ).toBe('pilots.terraagent.near');
    expect(colonyAccountCandidates('col_0', 'alex', 'pilots.terraagent.testnet')[0]).toBe(
      'col_0.alex.pilots.terraagent.testnet',
    );

    for (const label of ['pilots', 'protocol', 'staking', 'bounty', 'dao', 'res', 'deed', 'treasury', 'agents']) {
      expect(isReservedAccountName(label)).toBe(true);
      expect(deriveAccountName(label)).toBe(`${label}-1`);
    }

    const mapped = toNearException(
      new Error('Smart contract panicked: NEAR_NAME_TAKEN: pilot label already exists'),
    );
    expect(mapped).toBeInstanceOf(NearException);
    expect(mapped.errorCode).toBe('NEAR_NAME_TAKEN');
  });

  it('requires a NEP-413 walletSignature on StakingService.stake when NEAR_ADAPTER_STAKING=testnet', async () => {
    const deedRecord: StoredDeedRecord = {
      colonyId: 'col_0',
      planetId: 'pl_1',
      playerId: 'p1',
      accountId: 'alex.pilots.terraagent.testnet',
      tokenId: 'deed:col_0',
      contract: 'deed.terraagent.testnet',
      metadata: {
        version: 1,
        planet: 'pl_1',
        colony: 'col_0',
        status: 'active',
        settled: false,
        imageUrl: '/v1/deeds/deed:col_0/image',
      },
      metadataVersion: 1,
      status: 'active',
      settled: false,
      chainState: 'ACTIVE',
      pendingOpId: null,
      lastUpdateTx: 'tx-deed',
      lastError: null,
      lastDispatchedAt: new Date('2026-11-13T12:00:00.000Z'),
      lastDispatchedSimMs: 0n,
      pendingMilestone: null,
      createdAt: new Date('2026-11-13T12:00:00.000Z'),
      updatedAt: new Date('2026-11-13T12:00:00.000Z'),
      history: [],
    };
    const deeds = { findByColonyId: vi.fn().mockResolvedValue(deedRecord) } as unknown as DeedRepository;
    const claimService = {
      isAccountClaimed: vi.fn().mockResolvedValue({
        claimed: true,
        accountId: 'alex.pilots.terraagent.testnet',
        claimedAt: '2026-11-13T12:00:00.000Z',
        claimedByAccountId: 'alex.testnet',
      }),
    } as unknown as AccountClaimService;
    const stakingPort = { stake: vi.fn() } as unknown as StakingPort;
    const sync = { syncAccount: vi.fn() } as unknown as StakingPositionSyncService;

    const svc = new StakingService(
      new FlagsService(makeDbEnv({ TA_WAVES: 'all' })),
      stakingPort,
      deeds,
      claimService,
      sync,
      undefined,
      { NODE_ENV: 'test', NEAR_ADAPTER_STAKING: 'testnet' } as unknown as AppEnv,
    );

    await expect(
      svc.stake({
        colonyId: 'col_0',
        pool: 'astro-stakers.poolv1.near',
        amount: '10',
      }),
    ).rejects.toMatchObject({ errorCode: 'NEAR_PROVIDER_REJECTED' });
    expect(stakingPort.stake).not.toHaveBeenCalled();
  });
});
