import { describe, expect, it } from 'vitest';
import {
  COMMAND_KINDS,
  EVENT_KINDS,
  REJECT_CODES,
  commandDef,
  eventDef,
  parseCommandArgs,
  parseWaves,
  type CommandKind,
  type EventKind,
} from '../src';

describe('W03-01 contracts: commands, events, reject codes, W03 flag', () => {
  it('supports W03 wave flag in parseWaves', () => {
    const waves = parseWaves('..03');
    expect(waves.has('W00')).toBe(true);
    expect(waves.has('W01')).toBe(true);
    expect(waves.has('W02')).toBe(true);
    expect(waves.has('W03')).toBe(true);
    expect(waves.has('W04')).toBe(false);
  });

  it('registers all W03 commands and validates their strict args', () => {
    const required: CommandKind[] = [
      'repair',
      'demolish',
      'reorderTask',
      'dev.setwind',
      'dev.drainfuel',
      'dev.addload',
      'dev.damage',
    ];
    for (const k of required) expect(COMMAND_KINDS).toContain(k);
    // one way to build a Power Pylon: a plain `build` order (the multi-pylon power-line tool was removed)
    expect(COMMAND_KINDS).not.toContain('placePowerLine');
    expect(parseCommandArgs('enqueueTask', { task: { kind: 'build', building: 'pylon', q: 3, r: -1 } }).success).toBe(true);
    expect(parseCommandArgs('enqueueTask', { task: { kind: 'powerLine', tiles: [{ q: 0, r: 0 }] } }).success).toBe(false);

    expect(commandDef('repair').wave).toBe('W03');

    expect(parseCommandArgs('repair', { entityId: 7 }).success).toBe(true);
    expect(parseCommandArgs('repair', { q: 2, r: -1, workerId: 3, precedence: 'system' }).success).toBe(true);
    expect(parseCommandArgs('reorderTask', { taskId: 'q-1', direction: 'up', lane: 'hqGoals' }).success).toBe(true);

    expect(parseCommandArgs('dev.setwind', { pct: 120 }).success).toBe(true);
    expect(parseCommandArgs('dev.drainfuel', {}).success).toBe(true);
    expect(parseCommandArgs('dev.addload', { loadPerS: 90 }).success).toBe(true);
    expect(parseCommandArgs('dev.damage', { entityId: 4, pct: 60 }).success).toBe(true);
  });

  it('registers all W03 events in EventKind', () => {
    const events: EventKind[] = ['powerSevered', 'powerOverload', 'brownoutShed', 'nightSurvived'];
    for (const k of events) {
      expect(EVENT_KINDS).toContain(k);
      expect(eventDef(k).wave).toBe('W03');
    }
    expect(EVENT_KINDS).toContain('energyCollapse');
  });

  it('includes W03 reject codes worker_tier_locked, lane_full and outside_power_zone', () => {
    expect(REJECT_CODES).toEqual(expect.arrayContaining(['worker_tier_locked', 'lane_full', 'outside_power_zone']));
  });
});
