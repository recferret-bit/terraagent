import 'reflect-metadata';
import type { PrismaClient } from '@terra/db';
import { describe, expect, it, vi } from 'vitest';
import { CoreException } from '../../src/core/errors/index.js';
import { FlagsService } from '../../src/flags/flags.service.js';
import { ChainReadPort } from '../../src/near/application/ports/chain-read.port.js';
import type { StakingPort } from '../../src/near/application/ports/staking.port.js';
import { MockChainReadAdapter } from '../../src/near/infrastructure/adapters/chain-read/mock-chain-read.adapter.js';
import { ChainExplorerController } from '../../src/near/infrastructure/dev/chain-explorer.controller.js';

function createMockChainRead(prisma: PrismaClient): MockChainReadAdapter {
  return new MockChainReadAdapter(prisma, { latencyMinMs: 0, latencyMaxMs: 0, failRate: 0 });
}

function buildIndexedDeedRows(t1: Date, t2: Date) {
  return [
    {
      colonyId: 'col_0',
      planetId: 'pl_dune_01',
      playerId: 'p_1',
      accountId: 'col_0.pilot.terraagent.mock',
      tokenId: 'deed:col_0',
      contract: 'deeds.terraagent.mock',
      metadata: {
        planet: 'pl_dune_01',
        colony: 'col_0',
        stage: 4,
        terraformBp: 10000,
        status: 'settled',
        settled: true,
        version: 2,
        imageUrl: '/v1/near/deed/deed:col_0/image.png?v=2',
      },
      metadataVersion: 2,
      status: 'settled',
      settled: true,
      chainState: 'ACTIVE',
      pendingOpId: null,
      lastUpdateTx: 'mock:tx-settle-col0',
      updatedAt: t2,
      history: [
        {
          version: 1,
          change: 'Colony founded — Deed minted',
          opId: 'deed-mint:col_0',
          txHash: 'mock:tx-mint-col0',
          createdAt: t1,
        },
        {
          version: 2,
          change: 'Colony settled at Stage 4',
          opId: 'deed-settle:col_0',
          txHash: 'mock:tx-settle-col0',
          createdAt: t2,
        },
      ],
    },
  ];
}

function buildDeedPrismaMock(): PrismaClient {
  const t1 = new Date('2026-11-09T10:00:00Z');
  const t2 = new Date('2026-11-09T10:15:00Z');
  const t3 = new Date('2026-11-09T10:30:00Z');
  return {
    deed: { findMany: vi.fn().mockResolvedValue(buildIndexedDeedRows(t1, t2)) },
    mockChainNft: {
      findMany: vi.fn().mockResolvedValue([
        {
          collection: 'deed',
          tokenId: 'deed:col_0',
          ownerAccountId: 'col_0.pilot.terraagent.mock',
          metadata: { planet: 'pl_dune_01', colony: 'col_0', version: 2, settled: true, status: 'settled' },
          opId: 'deed-mint:col_0',
          mintedAt: t1,
          updatedAt: t2,
        },
        {
          collection: 'deed',
          tokenId: 'deed-raw_1',
          ownerAccountId: 'raw_1.pilot.terraagent.mock',
          metadata: { planet: 'pl_forest_02', colony: 'raw_1', version: 1, settled: false, status: 'active' },
          opId: 'deed-mint:raw_1',
          mintedAt: t3,
          updatedAt: t3,
        },
      ]),
    },
    mockChainNftMetaHistory: {
      findMany: vi.fn().mockResolvedValue([
        {
          collection: 'deed',
          tokenId: 'deed-raw_1',
          metadata: { planet: 'pl_forest_02', colony: 'raw_1', version: 1, settled: false, status: 'active' },
          opId: 'deed-mint:raw_1',
          at: t3,
        },
      ]),
    },
    mockChainReceipt: {
      findMany: vi.fn().mockResolvedValue([{ opId: 'deed-mint:raw_1', txHash: 'mock:tx-raw1' }]),
    },
  } as unknown as PrismaClient;
}

describe('W20-24 ChainExplorerController — deeds route', () => {
  it('returns deeds with version history, settled flag, and merges unindexed mockChainNft deed rows', async () => {
    const prisma = buildDeedPrismaMock();
    const flags = new FlagsService({ TA_WAVES: '..20' } as never);
    const controller = new ChainExplorerController(prisma, createMockChainRead(prisma), flags);

    const all = await controller.deeds({});
    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({
      tokenId: 'deed-raw_1',
      colonyId: 'raw_1',
      accountId: 'raw_1.pilot.terraagent.mock',
      version: 1,
      settled: false,
      status: 'active',
      lastUpdateTx: 'mock:tx-raw1',
    });
    expect(all[1]).toMatchObject({
      tokenId: 'deed:col_0',
      colonyId: 'col_0',
      accountId: 'col_0.pilot.terraagent.mock',
      version: 2,
      settled: true,
      status: 'settled',
      lastUpdateTx: 'mock:tx-settle-col0',
    });
    expect(all[1]?.history).toHaveLength(2);
    expect(all[1]?.history[0]).toMatchObject({
      version: 1,
      change: 'Colony founded — Deed minted',
      txHash: 'mock:tx-mint-col0',
    });
    expect(all[1]?.history[1]).toMatchObject({
      version: 2,
      change: 'Colony settled at Stage 4',
      txHash: 'mock:tx-settle-col0',
    });

    const filtered = await controller.deeds({ tokenId: 'deed-col_0' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.colonyId).toBe('col_0');
  });
});

describe('W20-24 ChainExplorerController — staking route', () => {
  it('returns staking positions and whitelisted pools in a unified row array', async () => {
    const now = new Date('2026-11-09T12:00:00Z');
    const prisma = {
      stakingPosition: {
        findMany: vi.fn().mockResolvedValue([
          {
            colonyId: 'col_0',
            poolId: 'astro-stakers.pool.mock',
            accountId: 'col_0.pilot.terraagent.mock',
            stakedSnapshot: { toFixed: () => '5000000000000000000000000' },
            unbondingSnapshot: { toFixed: () => '0' },
            withdrawableSnapshot: { toFixed: () => '0' },
            rewardsSnapshot: { toFixed: () => '125000000000000000000000' },
            updatedAt: now,
          },
        ]),
      },
      mockChainStaking: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;

    const stakingPort: Partial<StakingPort> = {
      listPools: vi.fn().mockResolvedValue([
        { poolId: 'astro-stakers.pool.mock', name: 'Astro Stakers', apyBp: 900 },
        { poolId: 'nebula-nodes.pool.mock', name: 'Nebula Nodes', apyBp: 900 },
      ]),
    };

    const flags = new FlagsService({ TA_WAVES: '..20' } as never);
    const controller = new ChainExplorerController(
      prisma,
      createMockChainRead(prisma),
      flags,
      stakingPort as StakingPort,
    );

    const rows = await controller.staking({});
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.kind === 'position')).toMatchObject({
      kind: 'position',
      pool: 'astro-stakers.pool.mock',
      accountId: 'col_0.pilot.terraagent.mock',
      colonyId: 'col_0',
      staked: '5',
      rewards: '0.125',
      unbonding: '0',
      apyBp: 900,
    });
    const pools = rows.filter((r) => r.kind === 'pool');
    expect(pools).toHaveLength(2);
    expect(pools[0]).toMatchObject({
      kind: 'pool',
      pool: 'astro-stakers.pool.mock',
      accountId: '-',
      colonyId: '-',
      staked: '5',
      rewards: '-',
      apyBp: 900,
    });
    expect(pools[1]).toMatchObject({
      kind: 'pool',
      pool: 'nebula-nodes.pool.mock',
      staked: '0',
      apyBp: 900,
    });

    const acctOnly = await controller.staking({ account: 'col_0.pilot.terraagent.mock' });
    expect(acctOnly).toHaveLength(1);
    expect(acctOnly[0]?.kind).toBe('position');
  });
});

describe('W20-24 ChainExplorerController — guards & validation', () => {
  it('guards deeds and staking with 404 when W20 is off or ChainRead is not MockChainReadAdapter, and ZodError on bad query', async () => {
    const prisma = {} as unknown as PrismaClient;
    const flagsOff = new FlagsService({ TA_WAVES: '..19' } as never);
    const controllerOff = new ChainExplorerController(prisma, createMockChainRead(prisma), flagsOff);

    await expect(controllerOff.deeds({ limit: 0 })).rejects.toMatchObject({
      errorCode: 'NOT_FOUND',
      status: 404,
    });
    await expect(controllerOff.staking({ limit: 0 })).rejects.toMatchObject({
      errorCode: 'NOT_FOUND',
      status: 404,
    });

    class NonMockChainRead extends ChainReadPort {
      explorerUrl(): string {
        return 'https://example.invalid';
      }
      async receipt(): Promise<null> {
        return null;
      }
      async health(): Promise<never> {
        throw new Error('not mock');
      }
      async ping(): Promise<never> {
        throw new Error('not mock');
      }
      async txStatus(): Promise<never> {
        throw new Error('not mock');
      }
    }
    const flagsOn = new FlagsService({ TA_WAVES: '..20' } as never);
    const controllerNonMock = new ChainExplorerController(prisma, new NonMockChainRead(), flagsOn);
    await expect(controllerNonMock.deeds({})).rejects.toBeInstanceOf(CoreException);

    const controllerOn = new ChainExplorerController(prisma, createMockChainRead(prisma), flagsOn);
    await expect(controllerOn.deeds({ limit: 0 })).rejects.toMatchObject({ name: 'ZodError' });
    await expect(controllerOn.deeds({ tokenId: '' })).rejects.toMatchObject({ name: 'ZodError' });
    await expect(controllerOn.staking({ limit: 201 })).rejects.toMatchObject({ name: 'ZodError' });
  });
});
