import { ClientMessage } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import type { GamePlanets } from '../../src/game/game-planets.service';
import { MarketTopics } from '../../src/ws/market-topics';
import { PlanetRooms, type RoomMember } from '../../src/ws/rooms';

const WATER = 'bio.water/USDC';
const METAL = 'metals.t1/USDC';

class Sock implements RoomMember {
  welcomeTick: number | undefined = 0;
  paused = false;
  bufferedAmount = 0;
  readonly sent: string[] = [];
  readonly topics = new MarketTopics();
  send(f: string | Uint8Array): void { this.sent.push(String(f)); }
  resync(): void { /* unused */ }
  wantsMarketPair(pair: string): boolean { return this.topics.wants(pair); }
}

/** A "legacy" member (no `wantsMarketPair` at all). */
class Legacy implements RoomMember {
  welcomeTick: number | undefined = 0;
  paused = false;
  bufferedAmount = 0;
  readonly sent: string[] = [];
  send(f: string | Uint8Array): void { this.sent.push(String(f)); }
  resync(): void { /* unused */ }
}

const rooms = () => new PlanetRooms({ subscribe: () => () => undefined } as unknown as GamePlanets);

describe('market topic filter', () => {
  it('a socket that never subscribed receives every pair', () => {
    const r = rooms(); const s = new Sock(); const l = new Legacy();
    r.join('pl', s); r.join('pl', l);
    r.broadcastMarket('pl', WATER, 'a'); r.broadcastMarket('pl', METAL, 'b');
    expect(s.sent).toEqual(['a', 'b']);
    expect(l.sent).toEqual(['a', 'b']);
  });

  it('subscribe narrows to the listed pairs; unsubscribe removes one, or all without pairs', () => {
    const r = rooms(); const s = new Sock(); const other = new Sock();
    r.join('pl', s); r.join('pl', other);
    s.topics.subscribe([WATER]);
    r.broadcastMarket('pl', WATER, 'w'); r.broadcastMarket('pl', METAL, 'm');
    expect(s.sent).toEqual(['w']);
    expect(other.sent).toEqual(['w', 'm']); // other sockets are unaffected
    s.topics.subscribe([METAL]);
    r.broadcastMarket('pl', METAL, 'm2');
    s.topics.unsubscribe([WATER]);
    r.broadcastMarket('pl', WATER, 'w2'); r.broadcastMarket('pl', METAL, 'm3');
    expect(s.sent).toEqual(['w', 'm2', 'm3']);
    s.topics.unsubscribe();
    r.broadcastMarket('pl', METAL, 'm4');
    expect(s.sent).toHaveLength(3);
  });

  it('unsubscribing from the default state silences the socket until it subscribes again', () => {
    const t = new MarketTopics();
    t.unsubscribe([WATER]);
    expect(t.wants(WATER)).toBe(false);
    expect(t.wants(METAL)).toBe(false);
    t.subscribe([METAL]);
    expect(t.wants(METAL)).toBe(true);
  });

  it('reset (leave, or a reconnect that makes a new socket) returns to all pairs', () => {
    const t = new MarketTopics();
    t.subscribe([WATER]);
    expect(t.wants(METAL)).toBe(false);
    t.reset();
    expect(t.wants(METAL)).toBe(true);
    expect(new MarketTopics().wants(METAL)).toBe(true); // a fresh Connection
  });

  it('never delivers to a socket without a welcome, nor to another planet', () => {
    const r = rooms(); const pending = new Sock(); pending.welcomeTick = undefined; const away = new Sock();
    r.join('pl', pending); r.join('elsewhere', away);
    r.broadcastMarket('pl', WATER, 'x');
    expect(pending.sent).toEqual([]);
    expect(away.sent).toEqual([]);
  });
});

describe('market.subscribe wire shape', () => {
  const frame = (t: string, d: unknown) => ClientMessage.safeParse({ v: 1, t, d });
  it('parses valid frames', () => {
    expect(frame('market.subscribe', { planetId: 'pl_a', pairs: [WATER] }).success).toBe(true);
    expect(frame('market.unsubscribe', { planetId: 'pl_a' }).success).toBe(true);
  });
  it('rejects bad pairs, extra keys and a missing planet', () => {
    expect(frame('market.subscribe', { planetId: 'pl_a', pairs: ['nonsense'] }).success).toBe(false);
    expect(frame('market.subscribe', { planetId: 'pl_a', pairs: [], extra: 1 }).success).toBe(false);
    expect(frame('market.subscribe', { pairs: [WATER] }).success).toBe(false);
    expect(frame('market.subscribe', { planetId: 'pl_a', pairs: Array(65).fill(WATER) }).success).toBe(false);
  });
});
