import { describe, expect, it } from 'vitest';
import {
  BOUNTY_TARGET_KINDS,
  COMMAND_KINDS,
  EVENT_KINDS,
  commandDef,
  commandGate,
  eventDef,
  parseCommandArgs,
  parseWaves,
  precheckClientCommand,
  type CommandKind,
  type EventKind,
} from '../src';

const REWARD = { resource: 'metals.t1' as const, amount: 200 };
const EXPIRES = 1_700_000_000_000;
const NEST = { target: { kind: 'clear_nest' as const, nestId: 'hive_n3' }, reward: REWARD, expiresAt: EXPIRES };
const DEFEND = {
  target: { kind: 'defend_area' as const, q: 4, r: -2, radius: 3, durationH: 2 },
  reward: { resource: 'minerals.t1' as const, amount: 50 },
  expiresAt: EXPIRES,
};
const DELIVER = {
  target: { kind: 'deliver_units' as const, resource: 'bio.water' as const, amount: 100 },
  reward: { resource: 'bio.biomass' as const, amount: 1 },
  expiresAt: EXPIRES,
};

const onW22 = {
  gate: (k: string) => commandGate(k, parseWaves('..22')),
  production: false,
  hasColony: true,
};

describe('W22-02 contracts: bounty commands, events, flag W22', () => {
  it('registers client bounty.post and bounty.claim, and module-only bounty.paid, on W22', () => {
    const client: CommandKind[] = ['bounty.post', 'bounty.claim'];
    for (const kind of client) {
      expect(COMMAND_KINDS).toContain(kind);
      expect(commandDef(kind).wave).toBe('W22');
      expect(commandDef(kind).origin).toBe('client');
    }
    const paid: CommandKind = 'bounty.paid';
    expect(COMMAND_KINDS).toContain(paid);
    expect(commandDef(paid).origin).toBe('module');
    expect(commandDef(paid).wave).toBe('W22');
  });

  it('parses the three target kinds', () => {
    expect(parseCommandArgs('bounty.post', NEST).success).toBe(true);
    expect(parseCommandArgs('bounty.post', DEFEND).success).toBe(true);
    expect(parseCommandArgs('bounty.post', DELIVER).success).toBe(true);
    expect(parseCommandArgs('bounty.post', { ...DEFEND, target: { ...DEFEND.target, radius: 1 } }).success).toBe(true);
    expect(parseCommandArgs('bounty.post', { ...DEFEND, target: { ...DEFEND.target, radius: 8, q: 32767, r: -32768 } }).success).toBe(true);
    expect(parseCommandArgs('bounty.claim', { bountyId: 'bt_01' }).success).toBe(true);
    expect(parseCommandArgs('bounty.paid', { bountyId: 'bt_01', claimerId: 'co_b', amount: 200 }).success).toBe(true);
    expect([...BOUNTY_TARGET_KINDS]).toEqual(['clear_nest', 'defend_area', 'deliver_units']);
  });

  it('rejects an unknown target kind as invalid_args', () => {
    const args = { target: { kind: 'raid_nest', nestId: 'hive_n3' }, reward: REWARD, expiresAt: EXPIRES };
    expect(parseCommandArgs('bounty.post', args).success).toBe(false);
    const pre = precheckClientCommand('bounty.post', args, onW22);
    expect(pre).toMatchObject({ ok: false, code: 'invalid_args' });
  });

  it('rejects extra fields, empty ids, out-of-range radius, non-positive amounts, and a non-T1 reward', () => {
    expect(parseCommandArgs('bounty.post', { ...NEST, note: 'x' }).success).toBe(false);
    expect(parseCommandArgs('bounty.post', { ...NEST, target: { ...NEST.target, extra: true } }).success).toBe(false);
    expect(parseCommandArgs('bounty.post', { ...NEST, target: { kind: 'clear_nest', nestId: '' } }).success).toBe(false);
    expect(parseCommandArgs('bounty.post', { ...DEFEND, target: { ...DEFEND.target, radius: 0 } }).success).toBe(false);
    expect(parseCommandArgs('bounty.post', { ...DEFEND, target: { ...DEFEND.target, radius: 9 } }).success).toBe(false);
    expect(parseCommandArgs('bounty.post', { ...DEFEND, target: { ...DEFEND.target, durationH: 0 } }).success).toBe(false);
    expect(parseCommandArgs('bounty.post', { ...NEST, reward: { resource: 'metals.t1', amount: 0 } }).success).toBe(false);
    expect(parseCommandArgs('bounty.post', { ...NEST, reward: { resource: 'metals.t2', amount: 10 } }).success).toBe(false);
    expect(parseCommandArgs('bounty.post', { ...NEST, expiresAt: 0 }).success).toBe(false);
    expect(parseCommandArgs('bounty.post', { ...DELIVER, target: { ...DELIVER.target, amount: 1.5 } }).success).toBe(false);
    expect(parseCommandArgs('bounty.claim', { bountyId: '' }).success).toBe(false);
    expect(parseCommandArgs('bounty.claim', { bountyId: 'bt_01', extra: 1 }).success).toBe(false);
    expect(parseCommandArgs('bounty.paid', { bountyId: 'bt_01', claimerId: 'co_b', amount: -1 }).success).toBe(false);
  });

  it('rejects bounty.paid from a client as unknown_kind, and gates bounty.post off below W22', () => {
    const paid = { bountyId: 'bt_01', claimerId: 'co_b', amount: 200 };
    const sentByClient = precheckClientCommand('bounty.paid', paid, {
      gate: (k) => commandGate(k, parseWaves('all')),
      production: false,
      hasColony: true,
    });
    expect(sentByClient).toEqual({ ok: false, code: 'unknown_kind' });
    expect(precheckClientCommand('bounty.post', NEST, onW22).ok).toBe(true);
    expect(commandGate('bounty.post', parseWaves('..22'))).toBeNull();
    expect(commandGate('bounty.post', parseWaves('..21'))).toBe('wave_disabled');
    expect(precheckClientCommand('bounty.post', NEST, {
      gate: (k) => commandGate(k, parseWaves('..21')),
      production: false,
      hasColony: true,
    })).toEqual({ ok: false, code: 'wave_disabled' });
  });

  it('registers the nine bounty and mercenary events on W22 for players', () => {
    const kinds: EventKind[] = [
      'bountyPosted',
      'bountyClaimed',
      'bountyCompleted',
      'bountyPaid',
      'bountyRefunded',
      'bountyExpired',
      'mercenaryHired',
      'mercenaryArrived',
      'mercenaryLeft',
    ];
    for (const k of kinds) {
      expect(EVENT_KINDS).toContain(k);
      expect(eventDef(k).wave).toBe('W22');
      expect(eventDef(k).audience).toBe('player');
    }
    expect(eventDef('bountyExpired').severity).toBe('warn');
    expect(eventDef('bountyRefunded').severity).toBe('warn');
    const completed = { bountyId: 'bt_01', claimer: 'co_b', kind: 'clear_nest' as const };
    expect(eventDef('bountyCompleted').data.safeParse(completed).success).toBe(true);
    expect(eventDef('bountyCompleted').data.safeParse({ ...completed, extra: true }).success).toBe(false);
    expect(eventDef('bountyCompleted').data.safeParse({ bountyId: 'bt_01' }).success).toBe(false);
    expect(eventDef('mercenaryLeft').data.safeParse({ bountyId: 'bt_01', rosterId: 'light', reason: 'wiped' }).success).toBe(true);
    expect(eventDef('mercenaryLeft').data.safeParse({ bountyId: 'bt_01', rosterId: 'light', reason: 'lost' }).success).toBe(false);
  });
});
