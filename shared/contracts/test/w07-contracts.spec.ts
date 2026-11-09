import { describe, expect, it } from 'vitest';
import {
  COMMAND_KINDS,
  EVENT_KINDS,
  STANCE_KINDS,
  WEAPON_TYPES,
  WaveId,
  attackMove,
  attackTarget,
  buildingDestroyed,
  commandDef,
  eventDef,
  faunaKilled,
  nestDestroyed,
  parseCommandArgs,
  parseWaves,
  projectileFired,
  projectileImpact,
  raidRepelled,
  raidStarted,
  setRally,
  setStance,
  underAttack,
  unitDestroyed,
  type CommandKind,
  type EventKind,
} from '../src';

describe('W07-01 contracts: combat & fauna commands, events, and W07 flag', () => {
  it('supports W07 wave flag in parseWaves', () => {
    expect(WaveId.safeParse('W07').success).toBe(true);
    const waves = parseWaves('..07');
    expect(waves.has('W07')).toBe(true);
    expect(waves.has('W08')).toBe(false);
    expect(parseWaves('..06').has('W07')).toBe(false);
  });

  it('registers all W07 commands with wave W07 and validates strict args', () => {
    const required: CommandKind[] = [
      'setStance',
      'setRally',
      'attackMove',
      'attackTarget',
    ];
    for (const k of required) {
      expect(COMMAND_KINDS).toContain(k);
      expect(commandDef(k).wave).toBe('W07');
    }

    expect(setStance.kind).toBe('setStance');
    expect(setRally.kind).toBe('setRally');
    expect(attackMove.kind).toBe('attackMove');
    expect(attackTarget.kind).toBe('attackTarget');
    expect(STANCE_KINDS).toEqual(['hold', 'defend', 'hunt']);
    expect(WEAPON_TYPES).toEqual(['bullet', 'shell', 'rocket', 'laser']);

    expect(parseCommandArgs('setStance', { entityId: 4, stance: 'hunt' }).success).toBe(true);
    expect(parseCommandArgs('setStance', { entityIds: [4, 5], stance: 'defend' }).success).toBe(true);
    expect(parseCommandArgs('setStance', { entityId: 4, stance: 'invalid' }).success).toBe(false);
    expect(parseCommandArgs('setStance', { stance: 'hold' }).success).toBe(false);
    expect(parseCommandArgs('setStance', { entityId: 4, stance: 'hold', extra: 1 }).success).toBe(false);

    expect(parseCommandArgs('setRally', { entityId: 10, q: 3, r: -2 }).success).toBe(true);
    expect(parseCommandArgs('setRally', { producerId: 10, q: 3, r: -2 }).success).toBe(true);
    expect(parseCommandArgs('setRally', { q: 3, r: -2 }).success).toBe(true);
    expect(parseCommandArgs('setRally', { q: 3 }).success).toBe(false);

    expect(parseCommandArgs('attackMove', { entityId: 7, q: 5, r: -1 }).success).toBe(true);
    expect(parseCommandArgs('attackMove', { entityIds: [7, 8], q: 5, r: -1 }).success).toBe(true);
    expect(parseCommandArgs('attackMove', { q: 5, r: -1 }).success).toBe(false);

    expect(parseCommandArgs('attackTarget', { entityId: 7, targetId: 42 }).success).toBe(true);
    expect(parseCommandArgs('attackTarget', { entityIds: [7, 8], targetId: 42 }).success).toBe(true);
    expect(parseCommandArgs('attackTarget', { entityId: 7 }).success).toBe(false);
  });

  it('registers all W07 events with wave W07 and validates event schemas', () => {
    const events: EventKind[] = [
      'projectileFired',
      'projectileImpact',
      'unitDestroyed',
      'buildingDestroyed',
      'underAttack',
      'raidStarted',
      'raidRepelled',
      'nestDestroyed',
      'faunaKilled',
    ];
    for (const k of events) {
      expect(EVENT_KINDS).toContain(k);
      expect(eventDef(k).wave).toBe('W07');
    }

    expect(
      projectileFired.data.safeParse({
        attackerId: 1,
        targetId: 2,
        weaponId: 'reconGun',
        weaponType: 'bullet',
        fromX: 0,
        fromY: 0,
        aimX: 3,
        aimY: 0,
      }).success,
    ).toBe(true);

    expect(
      projectileImpact.data.safeParse({
        attackerId: 1,
        aimX: 3,
        aimY: 0,
        hit: true,
      }).success,
    ).toBe(true);

    expect(unitDestroyed.data.safeParse({ entityId: 5, unit: 'recon', q: 1, r: 2 }).success).toBe(true);
    expect(buildingDestroyed.data.safeParse({ entityId: 6, building: 'autocannon', q: 1, r: 2 }).success).toBe(true);
    expect(underAttack.data.safeParse({ entityId: 6, q: 1, r: 2 }).success).toBe(true);
    expect(raidStarted.data.safeParse({ hiveId: 20, species: 'blackAnt', count: 3, q: 10, r: -5 }).success).toBe(true);
    expect(raidRepelled.data.safeParse({ hiveId: 20, unbreached: true }).success).toBe(true);
    expect(nestDestroyed.data.safeParse({ hiveId: 20, species: 'blackAnt', q: 10, r: -5 }).success).toBe(true);
    expect(faunaKilled.data.safeParse({ entityId: 21, species: 'blackAnt', q: 8, r: -4 }).success).toBe(true);
  });
});
