import { describe, expect, it, vi } from 'vitest';
import { fetchRows, PATH } from './api';
import { deedExplorerHref, TABS } from './columns';
import { parseExplorerSearch } from './main';

describe('W20-24 Explorer frontend api & columns', () => {
  it('defines deeds and staking tabs in PATH and TABS with expected columns and cell formatters', () => {
    expect(PATH.deeds).toBe('deeds');
    expect(PATH.staking).toBe('staking');

    const deedsTab = TABS.find((t) => t.id === 'deeds')!;
    expect(deedsTab.label).toBe('Deeds');
    expect(deedsTab.columns.map((c) => c.head)).toEqual([
      'TOKEN',
      'COLONY',
      'OWNER',
      'VER',
      'STATUS',
      'HISTORY',
      'HASH',
    ]);

    const sampleDeedRow = {
      tokenId: 'deed-col_0',
      colonyId: 'col_0',
      accountId: 'col_0.pilot.terraagent.mock',
      version: 2,
      settled: true,
      status: 'settled',
      lastUpdateTx: 'mock:abc123',
      history: [
        { version: 1, change: 'Minted' },
        { version: 2, change: 'Settled' },
      ],
    };
    expect(deedsTab.columns.map((c) => c.cell(sampleDeedRow))).toEqual([
      'deed-col_0',
      'col_0',
      'col_0.pilot.terraagent.mock',
      'v2',
      'SETTLED',
      'v1: Minted → v2: Settled',
      'mock:abc123',
    ]);
    expect(deedsTab.columns.find((c) => c.head === 'HASH')!.href?.(sampleDeedRow)).toBe(
      '/dev/chain/tx/mock%3Aabc123',
    );

    const stakingTab = TABS.find((t) => t.id === 'staking')!;
    expect(stakingTab.label).toBe('Staking');
    expect(stakingTab.columns.map((c) => c.head)).toEqual([
      'KIND',
      'POOL',
      'ACCOUNT',
      'COLONY',
      'STAKED',
      'REWARDS',
      'APY',
    ]);

    const sampleStakingRow = {
      kind: 'position',
      pool: 'astro-stakers.pool.mock',
      accountId: 'col_0.pilot.terraagent.mock',
      colonyId: 'col_0',
      staked: '5',
      rewards: '0.012',
      apyBp: 900,
    };
    expect(stakingTab.columns.map((c) => c.cell(sampleStakingRow))).toEqual([
      'position',
      'astro-stakers.pool.mock',
      'col_0.pilot.terraagent.mock',
      'col_0',
      '5',
      '0.012',
      '9%',
    ]);
  });
});

describe('W20-24 Explorer URL search routing & fetchRows', () => {
  it('parses ?tab=deeds&tokenId=deed-col_0 and passes tokenId to fetchRows', async () => {
    expect(deedExplorerHref('deed-col_0')).toBe('/dev/chain/?tab=deeds&tokenId=deed-col_0');
    expect(parseExplorerSearch('?tab=deeds&tokenId=deed-col_0')).toEqual({
      tab: 'deeds',
      account: '',
      tokenId: 'deed-col_0',
    });
    expect(parseExplorerSearch('?tokenId=deed:col_0&account=alice.test')).toEqual({
      tab: 'deeds',
      account: 'alice.test',
      tokenId: 'deed:col_0',
    });
    expect(parseExplorerSearch('?tab=staking')).toEqual({
      tab: 'staking',
      account: '',
      tokenId: '',
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ tokenId: 'deed-col_0' }],
    } as Response);
    try {
      const rows = await fetchRows('deeds', {
        account: 'col_0.pilot.terraagent.mock',
        tokenId: 'deed-col_0',
      });
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
