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
      'placePowerLine',
      'demolish',
      'reorderTask',
      'dev.setwind',
      'dev.drainfuel',
      'dev.addload',
      'dev.damage',
    ];
    for (const k of required) expect(COMMAND_KINDS).toContain(k);

    expect(commandDef('repair').wave).toBe('W03');
    expect(commandDef('placePowerLine').wave).toBe('W03');

    expect(parseCommandArgs('repair', { entityId: 7 }).success).toBe(true);
    expect(parseCommandArgs('repair', { q: 2, r: -1, workerId: 3, precedence: 'system' }).success).toBe(true);
    expect(parseCommandArgs('placePowerLine', { tiles: [{ q: 0, r: 0 }, { q: 6, r: 0 }] }).success).toBe(true);
    expect(parseCommandArgs('placePowerLine', { from: { q: 0, r: 0 }, to: { q: 12, r: 0 } }).success).toBe(true);
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

  it('includes W03 reject codes worker_tier_locked and lane_full', () => {
    expect(REJECT_CODES).toEqual(expect.arrayContaining(['worker_tier_locked', 'lane_full']));
  });
});
