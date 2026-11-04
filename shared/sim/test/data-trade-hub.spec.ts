import { describe, expect, it } from 'vitest';
import { compileData, dataRow, type CompiledRow } from '../src/data';

const W10_FLAGS = new Set(['W00', 'W01', 'W02', 'W10']);

function verifyT1Row(t1: CompiledRow): void {
  expect(t1.kind).toBe('building');
  expect(t1.building).toBe('tradeHub');
  expect(t1.label).toBe('Inter-Colony Trade Hub');
  expect(t1.archetype).toBe('building.tradeHub');
  expect(t1.tier).toBe(1);
  expect(t1.requiresHubTier).toBe(1);
  expect(t1.unlockStage).toBe(2);
  expect(t1.footprint).toBe(2);
  expect(t1.footprintW).toBe(2);
  expect(t1.footprintD).toBe(2);
  expect(t1.requiresPrepared).toBe(true);
  expect(t1.shedGroup).toBe(2);
  expect(t1.buildS).toBe(110);
  expect(t1.designBuildS).toBe(22);
  expect(t1.cost).toEqual({
    'metals.t1': 100,
    'minerals.t1': 80,
    'bio.biomass': 30,
    'bio.water': 10,
  });
  expect(t1.powerDrainPerS).toBe(6);
  expect(t1.hp).toBe(650);
  expect(t1.throughputPerMin).toBe(250);
  expect(t1.demolishRefundRatio).toBe(0.5);
  expect(t1.cancelRefundRatio).toBe(0.5);
}

function verifyT2Row(t2: CompiledRow): void {
  expect(t2.kind).toBe('building');
  expect(t2.building).toBe('tradeHub');
  expect(t2.label).toBe('Inter-Colony Trade Hub T2');
  expect(t2.archetype).toBe('building.tradeHub');
  expect(t2.tier).toBe(2);
  expect(t2.requiresHubTier).toBe(2);
  expect(t2.unlockStage).toBe(4);
  expect(t2.footprint).toBe(3);
  expect(t2.footprintW).toBe(3);
  expect(t2.footprintD).toBe(3);
  expect(t2.requiresPrepared).toBe(true);
  expect(t2.shedGroup).toBe(2);
  expect(t2.buildS).toBe(250);
  expect(t2.designBuildS).toBe(50);
  expect(t2.cost).toEqual({
    'metals.t1': 168,
    'metals.t2': 112,
    'minerals.t1': 144,
    'minerals.t2': 96,
    'bio.t2': 95,
    'bio.water': 30,
  });
  expect(t2.powerDrainPerS).toBe(16);
  expect(t2.hp).toBe(1750);
  expect(t2.throughputPerMin).toBe(900);
  expect(t2.demolishRefundRatio).toBe(0.5);
  expect(t2.cancelRefundRatio).toBe(0.5);
}

function verifyT3Row(t3: CompiledRow): void {
  expect(t3.kind).toBe('building');
  expect(t3.building).toBe('tradeHub');
  expect(t3.label).toBe('Inter-Colony Trade Hub T3');
  expect(t3.archetype).toBe('building.tradeHub');
  expect(t3.tier).toBe(3);
  expect(t3.requiresHubTier).toBe(3);
  expect(t3.unlockStage).toBe(6);
  expect(t3.footprint).toBe(4);
  expect(t3.footprintW).toBe(4);
  expect(t3.footprintD).toBe(4);
  expect(t3.requiresPrepared).toBe(true);
  expect(t3.shedGroup).toBe(2);
  expect(t3.buildS).toBe(550);
  expect(t3.designBuildS).toBe(110);
  expect(t3.cost).toEqual({
    'metals.t1': 312,
    'metals.t2': 234,
    'metals.t3': 234,
    'minerals.t1': 280,
    'minerals.t2': 210,
    'minerals.t3': 210,
    'bio.t2': 280,
    'bio.t3': 78,
    'bio.water': 90,
  });
  expect(t3.powerDrainPerS).toBe(42);
  expect(t3.hp).toBe(4500);
  expect(t3.throughputPerMin).toBe(3500);
  expect(t3.demolishRefundRatio).toBe(0.5);
  expect(t3.cancelRefundRatio).toBe(0.5);
}

function verifyCapsRow(caps: CompiledRow): void {
  expect(caps.kind).toBe('cargoCaps');
  expect(caps.dailyMintCapPerResource).toBe(20000);
  expect(caps.throughputWindowS).toBe(60);
}

describe('W10-02 data rows: tradeHub (Inter-Colony Trade Hub T1/T2/T3 and cargoCaps)', () => {
  it('compiles out all W10 tradeHub rows when W10 is disabled', () => {
    const compiled = compileData(new Set(['W00', 'W01', 'W02']));
    expect(compiled.tables.tradeHub).toBeDefined();
    expect(Object.keys(compiled.tables.tradeHub ?? {})).toHaveLength(0);
    expect(compiled.tables.tradeHub?.t1).toBeUndefined();
    expect(compiled.tables.tradeHub?.t2).toBeUndefined();
    expect(compiled.tables.tradeHub?.t3).toBeUndefined();
    expect(compiled.tables.tradeHub?.caps).toBeUndefined();
  });

  it('compiles tradeHub table with t1, t2, t3, caps, and unlock when W10 is enabled', () => {
    const compiled = compileData(W10_FLAGS);
    expect(Object.keys(compiled.tables.tradeHub)).toHaveLength(5);
    verifyT1Row(dataRow(compiled, 'tradeHub', 't1'));
    verifyT2Row(dataRow(compiled, 'tradeHub', 't2'));
    verifyT3Row(dataRow(compiled, 'tradeHub', 't3'));
    verifyCapsRow(dataRow(compiled, 'tradeHub', 'caps'));
    const unlock = dataRow(compiled, 'tradeHub', 'unlock');
    expect(unlock.kind).toBe('unlockRule');
    expect(unlock.rule).toBe('neighborContact(>=S2) | guildVisit | S5');
    expect(unlock.minContactStage).toBe(2);
    expect(unlock.autoUnlockStage).toBe(5);
    expect(unlock.tradeHubAtS2).toBe(true);
  });
});
