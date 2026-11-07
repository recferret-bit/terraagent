import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import { compileData, dataRow } from '../../src/data';

describe('W07-01 data rows: wave gating and weapons table', () => {
  it('excludes all W07 rows when wave set is ..06', () => {
    const compiled = compileData(parseWaves('..06'));
    expect(Object.keys(compiled.tables.weapons ?? {})).toHaveLength(0);
    expect(Object.keys(compiled.tables.combatUnits ?? {})).toHaveLength(0);
    expect(Object.keys(compiled.tables.fauna ?? {})).toHaveLength(0);
  });

  it('compiles all W07 weapon rows in tile units when TA_WAVES=..07', () => {
    const compiled = compileData(parseWaves('..07'));
    expect(dataRow(compiled, 'weapons', 'bullet')).toMatchObject({ weaponType: 'bullet', projSpeed: 20, aoe: 0, arc: 'direct' });
    expect(dataRow(compiled, 'weapons', 'shell')).toMatchObject({ weaponType: 'shell', projSpeed: 4, aoe: 1.5, arc: 'indirect', splashMult: 0.5 });
    expect(dataRow(compiled, 'weapons', 'rocket')).toMatchObject({ weaponType: 'rocket', projSpeed: 10, aoe: 1.0, arc: 'direct', splashMult: 0.5 });
    expect(dataRow(compiled, 'weapons', 'laser')).toMatchObject({ weaponType: 'laser', delivery: 'instant', aoe: 0 });
  });
});

describe('W07-01 data rows: combatUnits table', () => {
  it('compiles Recon T1, Robotics Factory T1, DCA T1, Autocannon T1, and Laser Tower T1', () => {
    const compiled = compileData(parseWaves('..07'));

    const recon = dataRow(compiled, 'combatUnits', 'recon');
    expect(recon.buildS).toBe(50);
    expect(recon.designBuildS).toBe(10);
    expect(recon.speed).toBeCloseTo(0.7, 5);
    expect(recon.hp).toBe(160);
    expect(recon.supply).toBe(1);
    expect(recon.powerDrainPerS).toBe(2);
    expect(recon.damage).toBe(7);
    expect(recon.ratePerS).toBe(2.0);
    expect(recon.range).toBe(4);
    expect(recon.viewRadius).toBe(10);
    expect(recon.hitsGround).toBe(true);
    expect(recon.hitsAir).toBe(false);
    expect(recon.evasive).toBe(false);

    const factory = dataRow(compiled, 'combatUnits', 'roboticsFactory');
    expect(factory).toMatchObject({ footprintW: 3, footprintD: 3, buildS: 125, powerDrainPerS: 10, hp: 800, shedGroup: 2, queueSlots: 5 });

    const dca = dataRow(compiled, 'combatUnits', 'droneControlArray');
    expect(dca).toMatchObject({ footprintW: 1, buildS: 70, powerDrainPerS: 5, hp: 350, supplyProvided: 8, shedGroup: 4 });

    const autocannon = dataRow(compiled, 'combatUnits', 'autocannon');
    expect(autocannon).toMatchObject({ buildS: 60, powerDrainPerS: 3, hp: 450, damage: 9, ratePerS: 2.0, range: 8, viewRadius: 9, hitsGround: true, hitsAir: true, shedGroup: 4 });

    const laserTower = dataRow(compiled, 'combatUnits', 'laserTower');
    expect(laserTower).toMatchObject({ buildS: 80, powerDrainPerS: 8, hp: 400, damage: 6, ratePerS: 4.0, range: 9, viewRadius: 10, hitsGround: true, hitsAir: true, shedGroup: 4 });
  });
});

describe('W07-01 data rows: fauna table', () => {
  it('compiles neutral insect fauna species and species-specific hives', () => {
    const compiled = compileData(parseWaves('..07'));

    const blackAnt = dataRow(compiled, 'fauna', 'blackAnt');
    expect(blackAnt).toMatchObject({ hp: 120, designSpeed: 2.0, radius: 0.3, damage: 8, attackIntervalS: 1.0, range: 1, hivePopCap: 12, replenishS: 60, threatCost: 1 });
    expect(blackAnt.speed).toBeCloseTo(0.4, 5);

    const blueBeetle = dataRow(compiled, 'fauna', 'blueBeetle');
    expect(blueBeetle).toMatchObject({ hp: 900, designSpeed: 0.8, radius: 0.8, damage: 24, attackIntervalS: 2.0, range: 1, hivePopCap: 3, replenishS: 180, threatCost: 4 });
    expect(blueBeetle.speed).toBeCloseTo(0.16, 5);

    const greenSpitter = dataRow(compiled, 'fauna', 'greenSpitter');
    expect(greenSpitter).toMatchObject({ hp: 180, designSpeed: 1.4, radius: 0.4, damage: 12, attackIntervalS: 2.0, range: 5, projSpeed: 4, aoe: 0, hivePopCap: 6, replenishS: 120, threatCost: 2 });
    expect(greenSpitter.speed).toBeCloseTo(0.28, 5);

    expect(dataRow(compiled, 'fauna', 'hiveBlackAnt').hp).toBe(1500);
    expect(dataRow(compiled, 'fauna', 'hiveBlueBeetle').hp).toBe(1500);
    expect(dataRow(compiled, 'fauna', 'hiveGreenSpitter').hp).toBe(1500);
  });
});
