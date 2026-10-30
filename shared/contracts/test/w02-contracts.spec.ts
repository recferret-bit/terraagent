import { describe, expect, it } from 'vitest';
import {
  COMMAND_KINDS,
  EVENT_KINDS,
  REJECT_CODES,
  commandDef,
  eventDef,
  parseCommandArgs,
  type CommandKind,
  type EventKind,
} from '../src';

describe('W02-01 contracts: commands, events, reject codes', () => {
  it('registers all W02 commands and validates their strict args', () => {
    const required: CommandKind[] = [
      'enqueueTask',
      'cancelTask',
      'reorderTask',
      'demolish',
      'setHarvestWeights',
      'dev.fill',
      'dev.time',
      'dev.skipnight',
      'dev.power',
    ];
    for (const k of required) expect(COMMAND_KINDS).toContain(k);

    expect(commandDef('reorderTask').wave).toBe('W02');
    expect(commandDef('demolish').wave).toBe('W02');
    expect(commandDef('setHarvestWeights').wave).toBe('W02');

    // enqueueTask supports build and buildUnit in addition to W01 terraform
    expect(parseCommandArgs('enqueueTask', { build: { building: 'metalsExtractor', q: 3, r: -2, tier: 1 } }).success).toBe(true);
    expect(parseCommandArgs('enqueueTask', { build: { building: 'solar', q: 0, r: 1, rotation: 2 } }).success).toBe(true);
    expect(parseCommandArgs('enqueueTask', { buildUnit: { unit: 'harvester', count: 3, repeat: true } }).success).toBe(true);
    expect(parseCommandArgs('enqueueTask', { buildUnit: { unit: 'harvester', count: 0 } }).success).toBe(false);
    expect(parseCommandArgs('enqueueTask', { unknownTask: {} }).success).toBe(false);

    expect(parseCommandArgs('cancelTask', { taskId: 'tsk_1' }).success).toBe(true);
    expect(parseCommandArgs('reorderTask', { taskId: 'tsk_3', toIndex: 0, lane: 'construction' }).success).toBe(true);
    expect(parseCommandArgs('demolish', { entityId: 42 }).success).toBe(true);
    expect(parseCommandArgs('setHarvestWeights', { minerals: 100, metals: 0 }).success).toBe(true);
    expect(parseCommandArgs('setHarvestWeights', { weights: { minerals: 100, metals: 0, bio: 50 } }).success).toBe(true);
    expect(parseCommandArgs('setHarvestWeights', { minerals: 200 }).success).toBe(false);

    expect(parseCommandArgs('dev.fill', { resource: 'metals.t1' }).success).toBe(true);
    expect(parseCommandArgs('dev.time', { target: '23:00' }).success).toBe(true);
    expect(parseCommandArgs('dev.skipnight', {}).success).toBe(true);
    expect(parseCommandArgs('dev.power', {}).success).toBe(true);
  });

  it('registers all W02 events in EventKind', () => {
    const events: EventKind[] = ['resourceShortage', 'energyCollapse', 'unitProduced', 'brownout', 'resourceProduced'];
    for (const k of events) {
      expect(EVENT_KINDS).toContain(k);
      expect(eventDef(k).wave).toBe('W02');
    }
  });

  it('includes W02 reject codes insufficient_resources and supply_cap', () => {
    expect(REJECT_CODES).toEqual(expect.arrayContaining(['insufficient_resources', 'supply_cap']));
  });
});
