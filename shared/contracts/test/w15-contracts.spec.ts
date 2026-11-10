import { describe, expect, it } from 'vitest';
import {
  COMMAND_KINDS,
  EVENT_KINDS,
  REJECT_CODES,
  ServerMessage,
  commandDef,
  commandGate,
  eventDef,
  parseCommandArgs,
  parseWaves,
  type CommandKind,
  type EventKind,
  type RejectCode,
} from '../src';

const OFFER = {
  offerId: 'kestrel:metals.t1:buy:1',
  shipId: 'kestrel',
  npcId: 'kestrel',
  npcAccountId: 'guild-1.npc.terraagent.mock',
  action: 'buy' as const,
  resource: 'metals.t1' as const,
  amount: 200,
  price: { token: 'bio.water' as const, amount: '70' },
  quoteSeq: 1,
};

const LIMITS = {
  'metals.t1': { maxPerTrade: 300, maxPerSession: 600, minStock: 200, partners: 'guild' as const },
};

describe('W15-01 contracts: guild commands, events, pushes, errors, flag W15', () => {
  it('registers the client commands on W15', () => {
    const kinds: CommandKind[] = ['market.acceptGuildOffer', 'setAutoTrade'];
    for (const k of kinds) {
      expect(COMMAND_KINDS).toContain(k);
      expect(commandDef(k).wave).toBe('W15');
      expect(commandDef(k).origin).toBe('client');
    }
  });

  it('accepts a guild offer id and a limits map, and rejects malformed args', () => {
    expect(parseCommandArgs('market.acceptGuildOffer', { offerId: OFFER.offerId }).success).toBe(true);
    expect(parseCommandArgs('setAutoTrade', { limits: LIMITS }).success).toBe(true);
    expect(parseCommandArgs('setAutoTrade', { limits: {} }).success).toBe(true);
    expect(parseCommandArgs('market.acceptGuildOffer', {}).success).toBe(false);
    expect(parseCommandArgs('market.acceptGuildOffer', { offerId: '' }).success).toBe(false);
    expect(parseCommandArgs('market.acceptGuildOffer', { offerId: 'x', extra: 1 }).success).toBe(false);
    expect(parseCommandArgs('setAutoTrade', { limits: { oil: LIMITS['metals.t1'] } }).success).toBe(false);
    expect(parseCommandArgs('setAutoTrade', { limits: { 'metals.t1': { ...LIMITS['metals.t1'], maxPerTrade: -1 } } }).success).toBe(false);
    expect(parseCommandArgs('setAutoTrade', {}).success).toBe(false);
  });

  it('registers guild and director events on W15', () => {
    const events: EventKind[] = ['guildTradeSettled', 'directorTrade', 'directorOrderRequested', 'directorAllowanceExhausted'];
    for (const k of events) {
      expect(EVENT_KINDS).toContain(k);
      expect(eventDef(k).wave).toBe('W15');
    }
    expect(eventDef('directorOrderRequested').audience).toBe('server');
    expect(eventDef('directorAllowanceExhausted').severity).toBe('warn');
    expect(eventDef('directorStatus').wave).toBe('W16');
  });

  it('adds the W15 reject codes', () => {
    const codes: RejectCode[] = ['offer_expired', 'director_key_missing', 'director_key_revoked', 'allowance_exhausted', 'autotrade_limit'];
    for (const c of codes) expect(REJECT_CODES).toContain(c);
  });

  it('parses guild.arrived, guild.departed and director.status, and rejects a seventh offer', () => {
    const arrived = { shipId: 'kestrel', planetId: 'pl_1', npcId: 'kestrel', name: 'Kestrel', departAt: 1_700_000_000_000, offers: [OFFER] };
    expect(ServerMessage.safeParse({ v: 1, t: 'guild.arrived', d: arrived }).success).toBe(true);
    expect(ServerMessage.safeParse({ v: 1, t: 'guild.arrived', d: { ...arrived, offers: Array.from({ length: 7 }, () => OFFER) } }).success).toBe(false);
    expect(ServerMessage.safeParse({ v: 1, t: 'guild.arrived', d: { ...arrived, offers: [{ ...OFFER, price: { token: 'metals.t1', amount: '1' } }] } }).success).toBe(false);
    expect(ServerMessage.safeParse({ v: 1, t: 'guild.departed', d: { shipId: 'kestrel', planetId: 'pl_1', npcId: 'kestrel' } }).success).toBe(true);
    const status = {
      colonyId: 'co_1', state: 'active',
      tokens: [{ token: 'metals.t1', allowance: '600', reserved: '0', spent: '0', available: '600' }],
    };
    expect(ServerMessage.safeParse({ v: 1, t: 'director.status', d: status }).success).toBe(true);
    expect(ServerMessage.safeParse({ v: 1, t: 'director.status', d: { ...status, state: 'paused' } }).success).toBe(false);
    expect(ServerMessage.safeParse({ v: 1, t: 'director.status', d: { ...status, tokens: [{ ...status.tokens[0], allowance: '600.5' }] } }).success).toBe(false);
  });

  it('gates W15 commands off below the wave and on at W15', () => {
    const below = parseWaves('..14');
    const on = parseWaves('..15');
    expect(below.has('W15')).toBe(false);
    expect(on.has('W15')).toBe(true);
    expect(commandGate('market.acceptGuildOffer', below)).toBe('wave_disabled');
    expect(commandGate('setAutoTrade', below)).toBe('wave_disabled');
    expect(commandGate('market.acceptGuildOffer', on)).toBeNull();
    expect(commandGate('setAutoTrade', on)).toBeNull();
    expect(commandGate('market.placeOrder', below)).toBeNull();
  });
});
