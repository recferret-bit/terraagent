import { parseWaves } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import { SimHost, compileData, createPlanet } from '../src';

describe('W18-01 sim flag gate & diplomacy data table', () => {
  it('compiles diplomacy data table when W18 is enabled and omits it under TA_WAVES=..17', () => {
    const dataW17 = compileData(parseWaves('..17'));
    const dataW18 = compileData(parseWaves('..18'));

    expect(Object.keys(dataW17.tables.diplomacy ?? {})).toHaveLength(0);
    expect(dataW18.tables.diplomacy?.truce).toBeDefined();
    expect(dataW18.tables.diplomacy?.pvp).toBeDefined();
    expect(dataW18.tables.diplomacy?.elimination).toBeDefined();
    // 600s * 5 ticks/s = 3000 ticks
    expect(dataW18.tables.diplomacy?.truce?.noticeS).toBe(3000);
    expect(dataW18.tables.diplomacy?.elimination?.criticalTimerS).toBe(3000);
  });

  it('rejects raid and diplomacy commands with wave_disabled when TA_WAVES=..17', () => {
    const flags = parseWaves('..17');
    const host = new SimHost({ flags });
    host.load(createPlanet({ seed: 'w18-01-gate', planetType: 'temperate' }));

    host.submit({
      commandId: 'cm_raid_1',
      colonyIndex: 0,
      source: 'player',
      kind: 'raid',
      args: { targetColonyId: 1 },
    });
    host.submit({
      commandId: 'cm_enq_raid_1',
      colonyIndex: 0,
      source: 'player',
      kind: 'enqueueTask',
      args: { raid: { targetColonyId: 1 } },
    });
    host.submit({
      commandId: 'cm_truce_1',
      colonyIndex: 0,
      source: 'player',
      kind: 'diplomacy.proposeTruce',
      args: { targetColonyId: 1, hours: 6 },
    });
    host.submit({
      commandId: 'cm_goal_raid_1',
      colonyIndex: 0,
      source: 'player',
      kind: 'queueGoal',
      args: { goal: 'raid_target', params: { targetColonyId: 1 } },
    });

    const res = host.step(1);
    expect(res.outcomes.map((o) => [o.commandId, o.code])).toEqual([
      ['cm_raid_1', 'wave_disabled'],
      ['cm_enq_raid_1', 'wave_disabled'],
      ['cm_truce_1', 'wave_disabled'],
      ['cm_goal_raid_1', 'wave_disabled'],
    ]);
  });
});
