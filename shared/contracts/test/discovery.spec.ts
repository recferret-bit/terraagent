import { describe, expect, it } from 'vitest';
import snapshotJson from '../schema/contracts.schema.json';
import { COMMAND_KINDS, CommandKindSchema, EVENT_KINDS, commandDef, eventDef, hasCommandKind, parseCommandArgs, type CommandKind, type EventKind } from '../src';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const snapshot = snapshotJson as any;

describe('contract auto-discovery', () => {
  it('lists dev.ping / dev.pong as kinds', () => {
    const c: CommandKind = 'dev.ping';
    const e: EventKind = 'dev.pong';
    expect(COMMAND_KINDS).toContain(c);
    expect(EVENT_KINDS).toContain(e);
    expect(CommandKindSchema.safeParse('dev.ping').success).toBe(true);
    expect(CommandKindSchema.safeParse('nope').success).toBe(false);
    expect(commandDef('dev.ping').origin).toBe('client');
    expect(eventDef('dev.pong').audience).toBe('player');
    expect(hasCommandKind('nope')).toBe(false);
  });

  it('checks args per kind, strictly', () => {
    expect(parseCommandArgs('dev.ping', {}).success).toBe(true);
    expect(parseCommandArgs('dev.ping', { note: 'hi' }).success).toBe(true);
    expect(parseCommandArgs('dev.ping', { extra: 1 }).success).toBe(false);
    expect(parseCommandArgs('no.such', {}).success).toBe(false);
  });

  it('commits a JSON-Schema snapshot covering messages, commands and events', () => {
    expect(snapshot.commands['dev.ping']).toMatchObject({ wave: 'W00', origin: 'client' });
    expect(snapshot.commands['dev.ping'].args.additionalProperties).toBe(false);
    expect(snapshot.events['dev.pong'].data.type).toBe('object');
    expect(Object.keys(snapshot.clientMessages)).toContain('cmd');
    expect(Object.keys(snapshot.serverMessages)).toEqual(expect.arrayContaining(['welcome', 'delta', 'cmd.reject']));
    expect(snapshot.serverMessages.welcome.properties.d.properties.state).toMatchObject({ contentEncoding: 'binary' });
  });
});
