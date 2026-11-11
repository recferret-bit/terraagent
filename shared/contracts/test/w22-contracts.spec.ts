import { describe, expect, it } from 'vitest';
import {
  COMMAND_KINDS,
  EVENT_KINDS,
  REST_ERROR_CODES,
  ServerMessage,
  TREASURY_EFFECT_KINDS,
  TREASURY_ERROR_CODES,
  commandDef,
  commandGate,
  eventDef,
  parseCommandArgs,
  parseWaves,
  precheckClientCommand,
  type CommandKind,
  type EventKind,
} from '../src';

const EFFECT = { kind: 'meteor_shield' as const, untilTick: 1_080, params: { magnitudeBp: 7500 } };

describe('W22-01 contracts: treasury command, events, push, errors, flag W22', () => {
  it('registers module-only system.treasuryEffect on W22', () => {
    const kind: CommandKind = 'system.treasuryEffect';
    expect(COMMAND_KINDS).toContain(kind);
    expect(commandDef(kind).wave).toBe('W22');
    expect(commandDef(kind).origin).toBe('module');
    expect(commandDef(kind).dev).toBeUndefined();
  });

  it('accepts the three project kinds and rejects an unknown kind, a missing tick, and extra fields', () => {
    expect(parseCommandArgs('system.treasuryEffect', EFFECT).success).toBe(true);
    expect(parseCommandArgs('system.treasuryEffect', { kind: 'guild_subsidy', untilTick: 0, params: { visits: 1 } }).success).toBe(true);
    expect(parseCommandArgs('system.treasuryEffect', { kind: 'terraform_boost', untilTick: 0 }).success).toBe(true);
    expect(parseCommandArgs('system.treasuryEffect', { kind: 'nuke', untilTick: 1 }).success).toBe(false);
    expect(parseCommandArgs('system.treasuryEffect', { kind: 'meteor_shield' }).success).toBe(false);
    expect(parseCommandArgs('system.treasuryEffect', { kind: 'meteor_shield', untilTick: -1 }).success).toBe(false);
    expect(parseCommandArgs('system.treasuryEffect', { ...EFFECT, extra: true }).success).toBe(false);
    expect(parseCommandArgs('system.treasuryEffect', { ...EFFECT, params: { magnitudeBp: 10_001 } }).success).toBe(false);
    expect([...TREASURY_EFFECT_KINDS]).toEqual(['meteor_shield', 'terraform_boost', 'guild_subsidy']);
  });

  it('rejects system.treasuryEffect when a client sends it, and gates it off below W22', () => {
    const sentByClient = precheckClientCommand('system.treasuryEffect', EFFECT, {
      gate: (k) => commandGate(k, parseWaves('all')),
      production: false,
      hasColony: true,
    });
    expect(sentByClient).toEqual({ ok: false, code: 'unknown_kind' });
    expect(commandGate('system.treasuryEffect', parseWaves('..21'))).toBe('wave_disabled');
    expect(commandGate('system.treasuryEffect', parseWaves('..22'))).toBeNull();
    expect(commandGate('system.treasuryEffect', parseWaves('all'))).toBeNull();
  });

  it('registers the six treasury events on W22', () => {
    const kinds: EventKind[] = [
      'treasuryProposalCreated',
      'treasuryVoteCast',
      'treasuryProposalPassed',
      'treasuryProposalFailed',
      'treasuryEffectStarted',
      'treasuryEffectEnded',
    ];
    for (const k of kinds) {
      expect(EVENT_KINDS).toContain(k);
      expect(eventDef(k).wave).toBe('W22');
    }
    expect(eventDef('treasuryProposalFailed').severity).toBe('warn');
    expect(eventDef('treasuryEffectStarted').audience).toBe('player');
  });

  it('parses the treasury.proposal push and lists the treasury error codes', () => {
    const msg = ServerMessage.parse({
      v: 1,
      t: 'treasury.proposal',
      d: {
        planetId: 'pl_dune',
        daoAccountId: 'pl-dune.dao.mock',
        proposalId: 3,
        kind: 'meteor_shield',
        state: 'InProgress',
        yes: 1,
        no: 0,
        members: 2,
        deadlineMs: 1_700_000_000_000,
        cost: '1500',
      },
    });
    expect(msg.t).toBe('treasury.proposal');
    expect(ServerMessage.safeParse({ v: 1, t: 'treasury.proposal', d: { planetId: 'pl_dune' } }).success).toBe(false);
    for (const code of TREASURY_ERROR_CODES) expect(REST_ERROR_CODES).toContain(code);
  });
});
