import 'reflect-metadata';
import type { PrismaClient } from '@terra/db';
import { describe, expect, it, vi } from 'vitest';
import { CoreException } from '../../src/core/errors/index.js';
import { FlagsService } from '../../src/flags/flags.service.js';
import { ChainReadPort } from '../../src/near/application/ports/chain-read.port.js';
import type { StakingPort } from '../../src/near/application/ports/staking.port.js';
import { MockChainReadAdapter } from '../../src/near/infrastructure/adapters/chain-read/mock-chain-read.adapter.js';
import { ChainExplorerController } from '../../src/near/infrastructure/dev/chain-explorer.controller.js';
import { fetchRows, PATH } from '../../../../frontend/game/dev/explorer/api.js';
import { deedExplorerHref, TABS } from '../../../../frontend/game/dev/explorer/columns.js';
import { parseExplorerSearch } from '../../../../frontend/game/dev/explorer/main.js';

function createMockChainRead(prisma: PrismaClient): MockChainReadAdapter {
  return new MockChainReadAdapter(prisma, { latencyMinMs: 0, latencyMaxMs: 0, failRate: 0 });
}

function buildDeedPrismaMock(): PrismaClient {
  const t1 = new Date('2026-11-09T10:00:00Z');
  const t2 = new Date('2026-11-09T10:15:00Z');
  const t3 = new Date('2026-11-09T10:30:00Z');
  return {
    deed: {
      findMany: vi.fn().mockResolvedValue([
        {
          colonyId: 'col_0',
          planetId: 'pl_dune_01',
          playerId: 'p_1',
          accountId: 'col_0.pilot.terraagent.mock',
          tokenId: 'deed:col_0',
          contract: 'deeds.terraagent.mock',
          metadata: {
            planet: 'pl_dune_01', colony: 'col_0', stage: 4, terraformBp: 10000,
            status: 'settled', settled: true, version: 2, imageUrl: '/v1/near/deed/deed:col_0/image.png?v=2',
          },
          metadataVersion: 2, status: 'settled', settled: true, chainState: 'ACTIVE',
          pendingOpId: null, lastUpdateTx: 'mock:tx-settle-col0', updatedAt: t2,
          history: [
            { version: 1, change: 'Colony founded — Deed minted', opId: 'deed-mint:col_0', txHash: 'mock:tx-mint-col0', createdAt: t1 },
            { version: 2, change: 'Colony settled at Stage 4', opId: 'deed-settle:col_0', txHash: 'mock:tx-settle-col0', createdAt: t2 },
          ],
        },
      ]),
    },
    mockChainNft: {
      findMany: vi.fn().mockResolvedValue([
        {
          collection: 'deed', tokenId: 'deed:col_0', ownerAccountId: 'col_0.pilot.terraagent.mock',
          metadata: { planet: 'pl_dune_01', colony: 'col_0', version: 2, settled: true, status: 'settled' },
          opId: 'deed-mint:col_0', mintedAt: t1, updatedAt: t2,
        },
        {
          collection: 'deed', tokenId: 'deed-raw_1', ownerAccountId: 'raw_1.pilot.terraagent.mock',
          metadata: { planet: 'pl_forest_02', colony: 'raw_1', version: 1, settled: false, status: 'active' },
          opId: 'deed-mint:raw_1', mintedAt: t3, updatedAt: t3,
        },
      ]),
    },
    mockChainNftMetaHistory: {
      findMany: vi.fn().mockResolvedValue([
        {
          collection: 'deed', tokenId: 'deed-raw_1',
          metadata: { planet: 'pl_forest_02', colony: 'raw_1', version: 1, settled: false, status: 'active' },
          opId: 'deed-mint:raw_1', at: t3,
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
      tokenId: 'deed-raw_1', colonyId: 'raw_1', accountId: 'raw_1.pilot.terraagent.mock',
      version: 1, settled: false, status: 'active', lastUpdateTx: 'mock:tx-raw1',
    });
    expect(all[1]).toMatchObject({
      tokenId: 'deed:col_0', colonyId: 'col_0', accountId: 'col_0.pilot.terraagent.mock',
      version: 2, settled: true, status: 'settled', lastUpdateTx: 'mock:tx-settle-col0',
    });
    expect(all[1]?.history).toHaveLength(2);
    expect(all[1]?.history[0]).toMatchObject({ version: 1, change: 'Colony founded — Deed minted', txHash: 'mock:tx-mint-col0' });
    expect(all[1]?.history[1]).toMatchObject({ version: 2, change: 'Colony settled at Stage 4', txHash: 'mock:tx-settle-col0' });

    const filtered = await controller.deeds({ tokenId: 'deed-col_0' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.colonyId).toBe('col_0');
  });
});

describe('W20-24 ChainExplorerController — staking & guards', () => {
  it('returns staking positions and whitelisted pools in a unified row array', async () => {
    const now = new Date('2026-11-09T12:00:00Z');
    const prisma = {
      stakingPosition: {
        findMany: vi.fn().mockResolvedValue([
          {
            colonyId: 'col_0', poolId: 'astro-stakers.pool.mock', accountId: 'col_0.pilot.terraagent.mock',
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
    const controller = new ChainExplorerController(prisma, createMockChainRead(prisma), flags, stakingPort as StakingPort);

    const rows = await controller.staking({});
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.kind === 'position')).toMatchObject({
      kind: 'position', pool: 'astro-stakers.pool.mock', accountId: 'col_0.pilot.terraagent.mock',
      colonyId: 'col_0', staked: '5', rewards: '0.125', unbonding: '0', apyBp: 900,
    });
    const pools = rows.filter((r) => r.kind === 'pool');
    expect(pools).toHaveLength(2);
    expect(pools[0]).toMatchObject({ kind: 'pool', pool: 'astro-stakers.pool.mock', accountId: '-', colonyId: '-', staked: '5', rewards: '-', apyBp: 900 });
    expect(pools[1]).toMatchObject({ kind: 'pool', pool: 'nebula-nodes.pool.mock', staked: '0', apyBp: 900 });

    const acctOnly = await controller.staking({ account: 'col_0.pilot.terraagent.mock' });
    expect(acctOnly).toHaveLength(1);
    expect(acctOnly[0]?.kind).toBe('position');
  });

  it('guards deeds and staking with 404 when W20 is off or ChainRead is not MockChainReadAdapter, and ZodError on bad query', async () => {
    const prisma = {} as unknown as PrismaClient;
    const flagsOff = new FlagsService({ TA_WAVES: '..19' } as never);
    const controllerOff = new ChainExplorerController(prisma, createMockChainRead(prisma), flagsOff);

    await expect(controllerOff.deeds({ limit: 0 })).rejects.toMatchObject({ errorCode: 'NOT_FOUND', status: 404 });
    await expect(controllerOff.staking({ limit: 0 })).rejects.toMatchObject({ errorCode: 'NOT_FOUND', status: 404 });

    class NonMockChainRead extends ChainReadPort {
      async ping(): Promise<never> { throw new Error('not mock'); }
      async txStatus(): Promise<never> { throw new Error('not mock'); }
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

describe('W20-24 Explorer frontend api, columns & URL search routing', () => {
  it('defines deeds and staking tabs in PATH and TABS with expected columns and cell formatters', () => {
    expect(PATH.deeds).toBe('deeds');
    expect(PATH.staking).toBe('staking');

    const deedsTab = TABS.find((t) => t.id === 'deeds')!;
    expect(deedsTab.label).toBe('Deeds');
    expect(deedsTab.columns.map((c) => c.head)).toEqual(['TOKEN', 'COLONY', 'OWNER', 'VER', 'STATUS', 'HISTORY', 'HASH']);

    const sampleDeedRow = {
      tokenId: 'deed-col_0', colonyId: 'col_0', accountId: 'col_0.pilot.terraagent.mock',
      version: 2, settled: true, status: 'settled', lastUpdateTx: 'mock:abc123',
      history: [{ version: 1, change: 'Minted' }, { version: 2, change: 'Settled' }],
    };
    expect(deedsTab.columns.map((c) => c.cell(sampleDeedRow))).toEqual([
      'deed-col_0', 'col_0', 'col_0.pilot.terraagent.mock', 'v2', 'SETTLED', 'v1: Minted → v2: Settled', 'mock:abc123',
    ]);
    expect(deedsTab.columns.find((c) => c.head === 'HASH')!.href?.(sampleDeedRow)).toBe('/dev/chain/tx/mock%3Aabc123');

    const stakingTab = TABS.find((t) => t.id === 'staking')!;
    expect(stakingTab.label).toBe('Staking');
    expect(stakingTab.columns.map((c) => c.head)).toEqual(['KIND', 'POOL', 'ACCOUNT', 'COLONY', 'STAKED', 'REWARDS', 'APY']);

    const sampleStakingRow = {
      kind: 'position', pool: 'astro-stakers.pool.mock', accountId: 'col_0.pilot.terraagent.mock',
      colonyId: 'col_0', staked: '5', rewards: '0.012', apyBp: 900,
    };
    expect(stakingTab.columns.map((c) => c.cell(sampleStakingRow))).toEqual([
      'position', 'astro-stakers.pool.mock', 'col_0.pilot.terraagent.mock', 'col_0', '5', '0.012', '9%',
    ]);
  });

  it('parses ?tab=deeds&tokenId=deed-col_0 and passes tokenId to fetchRows', async () => {
    expect(deedExplorerHref('deed-col_0')).toBe('/dev/chain/?tab=deeds&tokenId=deed-col_0');
    expect(parseExplorerSearch('?tab=deeds&tokenId=deed-col_0')).toEqual({ tab: 'deeds', account: '', tokenId: 'deed-col_0' });
    expect(parseExplorerSearch('?tokenId=deed:col_0&account=alice.test')).toEqual({ tab: 'deeds', account: 'alice.test', tokenId: 'deed:col_0' });
    expect(parseExplorerSearch('?tab=staking')).toEqual({ tab: 'staking', account: '', tokenId: '' });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true, status: 200, json: async () => [{ tokenId: 'deed-col_0' }],
    } as Response);
    try {
      const rows = await fetchRows('deeds', { account: 'col_0.pilot.terraagent.mock', tokenId: 'deed-col_0' });
      expect(rows).toEqual([{ tokenId: 'deed-col_0' }]);
      expect(fetchSpy).toHaveBeenCalledWith(
        '/v1/dev/chain/deeds?limit=100&account=col_0.pilot.terraagent.mock&tokenId=deed-col_0',
        { signal: undefined },
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
