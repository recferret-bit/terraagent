import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  compileData,
  dataRow,
  formatUnlockAtTooltip,
  getItemUnlockStage,
  getStageSpec,
  STAGE_TABLE_ROWS,
} from '../../src/data';

describe('W08-02 wave gating and unit conversion', () => {
  it('excludes stages table when wave set is ..07', () => {
    const compiled = compileData(parseWaves('..07'));
    expect(Object.keys(compiled.tables.stages ?? {})).toHaveLength(0);
  });

  it('includes S0..S4 and excludes S5+ when wave set is ..08', () => {
    const compiled = compileData(parseWaves('..08'));
    const stageIds = Object.keys(compiled.tables.stages ?? {});
    expect(stageIds).toEqual(['S0', 'S1', 'S2', 'S3', 'S4']);
    expect(compiled.tables.stages.S5).toBeUndefined();
    expect(compiled.tables.stages.S10).toBeUndefined();

    // Verify tick conversion for units: dwellS and targetTimeS (5 ticks/s)
    const s0 = dataRow(compiled, 'stages', 'S0');
    expect(s0.dwellS).toBe(0);
    expect(s0.designDwellS).toBe(0);
    expect(s0.targetTimeS).toBe(600); // 120s * 5

    const s1 = dataRow(compiled, 'stages', 'S1');
    expect(s1.dwellS).toBe(300); // 60s * 5
    expect(s1.designDwellS).toBe(60);
    expect(s1.targetTimeS).toBe(1800); // 360s * 5

    const s2 = dataRow(compiled, 'stages', 'S2');
    expect(s2.dwellS).toBe(600); // 120s * 5
    expect(s2.designDwellS).toBe(120);
    expect(s2.targetTimeS).toBe(4500); // 900s * 5

    const s3 = dataRow(compiled, 'stages', 'S3');
    expect(s3.dwellS).toBe(900); // 180s * 5
    expect(s3.designDwellS).toBe(180);
    expect(s3.targetTimeS).toBe(7500); // 1500s * 5

    const s4 = dataRow(compiled, 'stages', 'S4');
    expect(s4.dwellS).toBe(900); // 180s * 5
    expect(s4.designDwellS).toBe(180);
    expect(s4.targetTimeS).toBe(12000); // 2400s * 5
  });

  it('includes S0..S10 when wave set is all', () => {
    const compiled = compileData(parseWaves('all'));
    const stageIds = Object.keys(compiled.tables.stages ?? {});
    expect(stageIds).toEqual([
      'S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10',
    ]);
    expect(dataRow(compiled, 'stages', 'S10').stage).toBe(10);
  });
});

describe('W08-02 spec §6.2 stage row specifications', () => {
  it('matches spec §6.2 fields across all 11 stages', () => {
    expect(STAGE_TABLE_ROWS).toHaveLength(11);
    expect(STAGE_TABLE_ROWS).toMatchSnapshot();

    const expectedNames = [
      'Landing', 'First Light', 'The Grid', 'First Contact', 'Neighbor',
      'Industrial', 'Frontier', 'Heavy Metal', 'Apex', 'Orbital', 'Ascendant',
    ];
    const expectedTriggers = [
      'landed', 'hub_complete', 'extractor_and_generator', 'buildings_or_fauna',
      'factory_or_scout', 'sectors_or_hub_t2', 'refinery_and_units',
      'lab_and_sectors', 'foundry_and_fusion', 'hub_t3_and_uplink', 'first_rocket_launched',
    ];

    for (let i = 0; i <= 10; i++) {
      const row = STAGE_TABLE_ROWS[i];
      expect(row.stage).toBe(i);
      expect(row.id).toBe(`S${i}`);
      expect(row.name).toBe(expectedNames[i]);
      expect(row.label).toBe(`S${i} ${expectedNames[i]}`);
      expect(row.triggerKind).toBe(expectedTriggers[i]);
      expect(row.dwellS).toBe(row.designDwellS);
      expect(row.teaches.length).toBeGreaterThan(0);
      expect(row.triggerText.length).toBeGreaterThan(0);
      expect(row.unlockConditionText.length).toBeGreaterThan(0);
      expect(Array.isArray(row.units)).toBe(true);
      expect(Array.isArray(row.buildings)).toBe(true);
      expect(Array.isArray(row.orders)).toBe(true);
    }
  });
});

describe('W08-02 unlock helpers and tooltips', () => {
  it('evaluates item unlock stages accurately', () => {
    expect(getItemUnlockStage('robotics_factory')).toBe(3);
    expect(getItemUnlockStage('roboticsFactory')).toBe(3);
    expect(getItemUnlockStage('worker')).toBe(1);
    expect(getItemUnlockStage('pylon')).toBe(2);
    expect(getItemUnlockStage('depot')).toBe(2);
    expect(getItemUnlockStage('storageDepot')).toBe(2);
    expect(getItemUnlockStage('wind')).toBe(2);
    expect(getItemUnlockStage('waterExtractor')).toBe(2);
    expect(getItemUnlockStage('petroleumWell')).toBe(2);
    expect(getItemUnlockStage('supplyDepot')).toBe(2);
    expect(getItemUnlockStage('thermal')).toBe(3);
    expect(getItemUnlockStage('hq')).toBe(0);
    expect(getItemUnlockStage('commandHub')).toBe(0);
    expect(getItemUnlockStage('metalsExtractor')).toBe(1);
    expect(getItemUnlockStage('outpostBeacon')).toBe(4);
    expect(getItemUnlockStage('smelter')).toBe(5);
    expect(getItemUnlockStage('nonexistent_item')).toBe(0);
  });

  it('formats unlock tooltips and retrieves stage specs', () => {
    expect(formatUnlockAtTooltip(2)).toBe('Unlocks at S2: extractor + generator · 2 min');
    expect(formatUnlockAtTooltip(1)).toBe('Unlocks at S1: Command Hub T1 complete · 1 min');
    expect(formatUnlockAtTooltip(3)).toBe('Unlocks at S3: 6 buildings + 2nd extractor · 3 min');
    expect(formatUnlockAtTooltip(4)).toBe('Unlocks at S4: Robotics Factory T1 + 5 tiles scouted · 3 min');
    expect(formatUnlockAtTooltip(99)).toBe('Unlocks at S99');

    expect(getStageSpec(2)?.name).toBe('The Grid');
    expect(getStageSpec(0)?.triggerKind).toBe('landed');
    expect(getStageSpec(99)).toBeUndefined();
  });
});
