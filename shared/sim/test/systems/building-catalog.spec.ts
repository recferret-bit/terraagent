import { Welcome } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import { buildingCatalog, compileData } from '../../src';

const welcome = (buildings?: ReturnType<typeof buildingCatalog>) => ({
  v: 1,
  t: 'welcome' as const,
  tick: 0,
  d: {
    reason: 'join' as const,
    colonyId: null,
    planet: { id: 'pl_01ARZ3NDEKTSV4RRFFQ69G5FAV', type: 'temperate' as const, name: 'x' },
    state: new Uint8Array(),
    simVersion: 1,
    dataHash: 'h',
    tick: 0,
    serverTimeMs: 1,
    tickMs: 200 as const,
    deltaHz: 5 as const,
    flags: ['W02'],
    ...(buildings ? { buildings } : {}),
  },
});

describe('building catalog', () => {
  it('reads footprint, time, price, HP, power and placement from the balance tables', () => {
    const rows = buildingCatalog(compileData(new Set(['W00', 'W01', 'W02', 'W03', 'W07', 'W10'])));
    const hub = rows.find((r) => r.building === 'commandHub');
    const solar = rows.find((r) => r.building === 'solar');
    expect(hub).toMatchObject({
      footprintW: 3,
      footprintD: 3,
      buildS: 30,
      hp: 1500,
      powerDrainPerS: 7,
      cost: { 'metals.t1': 200, 'minerals.t1': 100 },
      hqOnly: true,
      allowUnclaimed: true,
      maxPerColony: 1,
      requiresDeposit: null,
    });
    expect(solar).toMatchObject({
      footprintW: 2,
      footprintD: 2,
      buildS: 18,
      powerDrainPerS: 1,
      powerGenPerS: 13,
      hqOnly: false,
      allowUnclaimed: true,
      maxPerColony: null,
      requiresDeposit: null,
    });
    expect(rows.find((r) => r.building === 'metalsExtractor')).toMatchObject({
      requiresDeposit: 'metals',
      allowUnclaimed: true,
      hqOnly: false,
      maxPerColony: null,
    });
    expect(new Set(rows.map((r) => `${r.building}:${r.tier}`)).size).toBe(rows.length);
    expect(Welcome.parse(welcome()).d.buildings).toBeUndefined();
    expect(Welcome.parse(welcome(rows)).d.buildings).toHaveLength(rows.length);
  });

  it('treats an explicit allowUnclaimedPlacement of false as closed ground', () => {
    const rows = buildingCatalog(compileData(new Set(['W01']), { hub: { t1: { allowUnclaimedPlacement: false } } }));
    expect(rows.find((r) => r.building === 'commandHub')?.allowUnclaimed).toBe(false);
  });
});
