import type { PrismaClient } from '@terra/db';
import type { Fill } from '@terra/sim/systems/trade/market-matcher';
import { describe, expect, it } from 'vitest';
import { FlagsService } from '../../src/flags/flags.service.js';
import { ProgressionEventForwarder } from '../../src/game/progression-events.service.js';
import { GuildContactProducer } from '../../src/market/progression/guild-contact.producer.js';
import {
  guildContactEvent,
  guildContactEventId,
  guildContactFills,
  liveTradeId,
  type GuildContactFill,
  type GuildContactOrder,
} from '../../src/market/progression/guild-contact-events.js';
import { FactsUpdaterService } from '../../src/progression/facts-updater.service.js';
import { FactsStore, InMemoryFactsStore } from '../../src/progression/facts.store.js';

const playerSide = { actorKind: 'player', colonyId: 'c1', playerId: 'p1' };
const npcSide = { actorKind: 'npc', colonyId: 'kestrel', playerId: null };

function fill(tradeId: string, amount = 4, over: Partial<GuildContactFill> = {}): GuildContactFill {
  return {
    tradeId,
    planetId: 'pl',
    amount,
    buyer: playerSide,
    seller: npcSide,
    ...over,
  };
}

function memoryProducer(waves = 'all', forwarder?: ProgressionEventForwarder, prisma?: PrismaClient) {
  const store = new InMemoryFactsStore();
  const facts = new FactsUpdaterService(store as unknown as FactsStore);
  const flags = new FlagsService({ TA_WAVES: waves } as never);
  const applied: string[] = [];
  const original = facts.applyProgressEvent.bind(facts);
  facts.applyProgressEvent = async (event) => {
    applied.push(event.eventId ?? '');
    return original(event);
  };
  const producer = new GuildContactProducer(facts, flags, forwarder, prisma);
  return { store, producer, applied };
}

const order = (over: Partial<GuildContactOrder>): GuildContactOrder => ({
  orderId: 'o',
  planetId: 'pl',
  colonyId: 'c',
  playerId: 'p',
  actorKind: 'player',
  filled: 0n,
  ...over,
});

const leg = (over: Partial<Fill> = {}): Fill => ({
  makerOrderId: 'm',
  takerOrderId: 't',
  makerSide: 'sell',
  buyerOrderId: 't',
  sellerOrderId: 'm',
  buyerColonyId: 'c1',
  sellerColonyId: 'kestrel',
  qty: 4n,
  price: { num: 8n, den: 4n },
  ...over,
});

describe('guild contact event', () => {
  it('one npc side is +1 for the player, with a stable event id', () => {
    const event = guildContactEvent(fill('tr_1'));
    expect(event).toMatchObject({
      eventId: guildContactEventId('tr_1', 'p1'),
      playerId: 'p1',
      colonyId: 'c1',
      family: 'guild-contact',
      metric: 'counter',
      value: 1,
    });
    expect(guildContactEvent({ ...fill('tr_1'), buyer: npcSide, seller: playerSide })?.playerId).toBe('p1');
  });

  it('player-player, zero amount, same owner and same colony do not count', () => {
    expect(
      guildContactEvent(fill('pp', 4, { seller: { actorKind: 'player', colonyId: 'c2', playerId: 'p2' } })),
    ).toBeNull();
    expect(guildContactEvent(fill('zero', 0))).toBeNull();
    expect(guildContactEvent(fill('neg', -1))).toBeNull();
    expect(
      guildContactEvent(fill('own', 4, { seller: { actorKind: 'npc', colonyId: 'kestrel', playerId: 'p1' } })),
    ).toBeNull();
    expect(
      guildContactEvent(fill('col', 4, { seller: { actorKind: 'npc', colonyId: 'c1', playerId: null } })),
    ).toBeNull();
    expect(
      guildContactEvent(
        fill('nn', 4, { buyer: npcSide, seller: { actorKind: 'npc', colonyId: 'vanguard', playerId: null } }),
      ),
    ).toBeNull();
  });

  it('a bot owner counts; fixture and guild kind do not', () => {
    expect(
      guildContactEvent(fill('bot', 4, { buyer: { actorKind: 'bot', colonyId: 'c1', playerId: 'p1' } }))?.value,
    ).toBe(1);
    expect(
      guildContactEvent(fill('fix', 4, { buyer: { actorKind: 'fixture', colonyId: 'c1', playerId: 'p1' } })),
    ).toBeNull();
    expect(
      guildContactEvent(fill('gld', 4, { seller: { actorKind: 'guild', colonyId: 'kestrel', playerId: null } })),
    ).toBeNull();
  });

  it('keeps a live id, skips a dead trade, and prefers the highest retry suffix', () => {
    expect(liveTradeId('tr', null, [])).toBe('tr');
    expect(liveTradeId('tr', { state: 'PENDING' }, [])).toBe('tr');
    expect(liveTradeId('tr', { state: 'FAILED' }, [])).toBeNull();
    expect(
      liveTradeId('tr', { state: 'FAILED' }, [
        { tradeId: 'tr~2', state: 'PENDING' },
        { tradeId: 'tr~10', state: 'FINAL' },
        { tradeId: 'tr', state: 'FAILED' },
      ]),
    ).toBe('tr~10');
  });
});

describe('GuildContactProducer', () => {
  it('one npc fill is +1, a second trade id is 2, and the same trade id stays 1', async () => {
    const { store, producer, applied } = memoryProducer();
    await producer.note(fill('tr_1'));
    await producer.note(fill('tr_1'));
    await producer.note(fill('tr_2'));
    expect(await store.get('p1', 'guild-contact')).toBe(2);
    expect(applied).toEqual([guildContactEventId('tr_1', 'p1'), guildContactEventId('tr_2', 'p1')]);
  });

  it('a player fill, a zero fill and a same-owner fill do not increment', async () => {
    const { store, producer } = memoryProducer();
    await producer.note(fill('pp', 4, { seller: { actorKind: 'player', colonyId: 'c2', playerId: 'p2' } }));
    await producer.note(fill('zero', 0));
    await producer.note(fill('own', 4, { seller: { actorKind: 'npc', colonyId: 'kestrel', playerId: 'p1' } }));
    expect(await store.get('p1', 'guild-contact')).toBe(0);
  });

  it('does not emit while W15 is off', async () => {
    const { store, producer, applied } = memoryProducer('..14');
    await producer.note(fill('tr_off'));
    expect(await store.get('p1', 'guild-contact')).toBe(0);
    expect(applied).toEqual([]);
  });

  it('counts two npc legs from one match and ignores a player leg and a zero qty', async () => {
    const { store, producer } = memoryProducer();
    const taker = order({ orderId: 't', colonyId: 'c1', playerId: 'p1', actorKind: 'player' });
    const npc = order({ orderId: 'm1', colonyId: 'kestrel', playerId: null, actorKind: 'npc' });
    const npc2 = order({ orderId: 'm2', colonyId: 'vanguard', playerId: null, actorKind: 'npc' });
    const human = order({ orderId: 'm3', colonyId: 'c2', playerId: 'p2', actorKind: 'player' });
    await producer.noteOutcome({
      incoming: taker,
      makers: new Map([
        ['m1', npc],
        ['m2', npc2],
        ['m3', human],
      ]),
      fills: [
        leg({ makerOrderId: 'm1', sellerOrderId: 'm1', qty: 4n }),
        leg({ makerOrderId: 'm2', sellerOrderId: 'm2', qty: 2n }),
        leg({ makerOrderId: 'm3', sellerOrderId: 'm3', qty: 9n }),
        leg({ makerOrderId: 'm1', sellerOrderId: 'm1', qty: 0n }),
      ],
    });
    expect(
      guildContactFills({
        incoming: taker,
        makers: new Map([['m1', npc]]),
        fills: [leg({ makerOrderId: 'm1', sellerOrderId: 'm1', qty: 0n })],
      })[0]?.amount,
    ).toBe(0);
    expect(await store.get('p1', 'guild-contact')).toBe(2);
  });

  it('resolves a missing player id from the forwarder and skips when none is known', async () => {
    const forwarder = new ProgressionEventForwarder({
      emit() {
        return undefined;
      },
    } as never);
    forwarder.registerColony('c1', 'p1');
    const known = memoryProducer('all', forwarder);
    await known.producer.note(fill('tr_known', 4, { buyer: { actorKind: 'player', colonyId: 'c1', playerId: null } }));
    expect(await known.store.get('p1', 'guild-contact')).toBe(1);

    const unknown = memoryProducer();
    await unknown.producer.note(
      fill('tr_unknown', 4, { buyer: { actorKind: 'player', colonyId: 'c1', playerId: null } }),
    );
    expect(await unknown.store.get('p1', 'guild-contact')).toBe(0);
  });

  it('does not count a FAILED trade, and a live retry is one new id', async () => {
    const dead = {
      intentTrade: { findUnique: async () => ({ state: 'FAILED' }), findMany: async () => [] },
    } as unknown as PrismaClient;
    const skipped = memoryProducer('all', undefined, dead);
    await skipped.producer.note(fill('tr_dead', 4, { takerOrderId: 't', makerOrderId: 'm' }));
    expect(await skipped.store.get('p1', 'guild-contact')).toBe(0);

    const retry = {
      intentTrade: {
        findUnique: async () => ({ state: 'FAILED' }),
        findMany: async () => [{ tradeId: 'tr_dead~1', state: 'PENDING' }],
      },
    } as unknown as PrismaClient;
    const lived = memoryProducer('all', undefined, retry);
    await lived.producer.note(fill('tr_dead', 4, { takerOrderId: 't', makerOrderId: 'm' }));
    await lived.producer.note(fill('tr_dead', 4, { takerOrderId: 't', makerOrderId: 'm' }));
    expect(await lived.store.get('p1', 'guild-contact')).toBe(1);
    expect(lived.applied).toEqual([guildContactEventId('tr_dead~1', 'p1')]);
  });
});
