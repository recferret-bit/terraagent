import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import { compileData, dataRow } from '../../src/data';

describe('W22-02 bounty and mercenary data rows', () => {
  it('drops bounty and mercenary rows when W22 is off', () => {
    const off = compileData(parseWaves('..21'));
    expect(off.tables.bounty).toEqual({});
    expect(off.tables.mercenary).toEqual({});
  });

  it('keeps the three target kinds, the posting bounds, and the proposed roster when W22 is on', () => {
    const on = compileData(parseWaves('..22'));
    expect(dataRow(on, 'bounty', 'clear_nest')).toMatchObject({ damageWindowS: 60, damageWindowTicks: 300 });
    expect(dataRow(on, 'bounty', 'defend_area')).toMatchObject({ radiusMin: 1, radiusMax: 8, presenceMinBp: 8000 });
    expect(dataRow(on, 'bounty', 'deliver_units')).toMatchObject({ amountMin: 1 });
    expect(dataRow(on, 'bounty', 'policy')).toMatchObject({ maxActive: 3, expiryMinH: 2, expiryMaxH: 48 });
    expect(dataRow(on, 'mercenary', 'light')).toMatchObject({
      accountId: 'merc-1.npc.terraagent.mock',
      archetype: 'robot.recon',
      count: 4,
      pricePerGameHour: { 'metals.t1': 100 },
    });
    expect(dataRow(on, 'mercenary', 'heavy')).toMatchObject({
      accountId: 'merc-2.npc.terraagent.mock',
      count: 6,
      pricePerGameHour: { 'metals.t1': 200 },
    });
    expect(dataRow(on, 'mercenary', 'reserve')).toMatchObject({
      accountId: 'merc-3.npc.terraagent.mock',
      archetype: 'robot.recon',
      count: 4,
      pricePerGameHour: { 'metals.t1': 100 },
    });
  });

  it('rejects a fractional or unknown mercenary price', () => {
    const flags = parseWaves('..22');
    expect(() => compileData(flags, { mercenary: { light: { pricePerGameHour: { 'metals.t1': 100.5 } } } })).toThrow(/metals\.t1/);
    expect(() => compileData(flags, { mercenary: { heavy: { pricePerGameHour: { gold: 200 } } } })).toThrow(/unknown resource "gold"/);
    expect(dataRow(compileData(flags, { mercenary: { light: { pricePerGameHour: { 'metals.t1': 80 } } } }), 'mercenary', 'light').pricePerGameHour).toEqual({ 'metals.t1': 80 });
  });
});
