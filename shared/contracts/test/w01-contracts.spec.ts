import { describe, expect, it } from 'vitest';
import {
  COMMAND_KINDS,
  EVENT_KINDS,
  REJECT_CODES,
  RESOURCE_FAMILIES,
  RESOURCE_KEYS,
  T1_RESOURCE_KEYS,
  parseCommandArgs,
  eventDef,
  type CommandKind,
  type EventKind,
} from '../src';

describe('W01-01 contracts: commands, events, ResourceKey, reject codes', () => {
  it('registers all W01 commands in CommandKind and validates their strict args', () => {
    const required: CommandKind[] = ['placeBuilding', 'enqueueTask', 'cancelTask', 'moveUnit'];
    for (const k of required) expect(COMMAND_KINDS).toContain(k);

    expect(parseCommandArgs('placeBuilding', { building: 'commandHub', q: 0, r: 0 }).success).toBe(true);
    expect(parseCommandArgs('placeBuilding', { building: 'commandHub', q: 0, r: 0, extra: 1 }).success).toBe(false);

    expect(parseCommandArgs('enqueueTask', { terraform: { op: 'grade', tiles: [{ q: 1, r: -1 }] } }).success).toBe(true);
    expect(parseCommandArgs('enqueueTask', { terraform: { op: 'clear', tiles: [{ q: 0, r: 0 }] } }).success).toBe(true);
    expect(parseCommandArgs('enqueueTask', { terraform: { op: 'break', tiles: [{ q: 2, r: 3 }] } }).success).toBe(true);
    expect(parseCommandArgs('enqueueTask', { terraform: { op: 'nope', tiles: [{ q: 0, r: 0 }] } }).success).toBe(false);

    expect(parseCommandArgs('cancelTask', { taskId: 'tsk_1' }).success).toBe(true);
    expect(parseCommandArgs('moveUnit', { entityId: 1, q: 4, r: -2 }).success).toBe(true);
  });

  it('registers all W01 events in EventKind', () => {
    const events: EventKind[] = ['colonyFounded', 'hqLanded', 'tilePrepared', 'obstacleRemoved', 'buildingCompleted'];
    for (const k of events) {
      expect(EVENT_KINDS).toContain(k);
      expect(eventDef(k).wave).toBe('W01');
    }
  });

  it('defines the 10 D-34 ResourceKey values across 3 families and the 4 T1 keys', () => {
    expect(RESOURCE_FAMILIES).toEqual(['metals', 'minerals', 'bio']);
    expect(RESOURCE_KEYS).toHaveLength(10);
    expect(T1_RESOURCE_KEYS).toEqual(['metals.t1', 'minerals.t1', 'bio.water', 'bio.biomass']);
  });

  it('includes W01 reject codes site_blocked, terrain_unbuildable, not_own_territory', () => {
    expect(REJECT_CODES).toEqual(expect.arrayContaining(['site_blocked', 'terrain_unbuildable', 'not_own_territory']));
  });
});
