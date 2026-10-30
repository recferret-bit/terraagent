import { decodeWire } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import { BACKPRESSURE_HIGH, BACKPRESSURE_LOW, PlanetRooms, type RoomMember } from '../../src/ws/rooms';
import type { GamePlanets, PlanetSubscriber } from '../../src/game/game-planets.service';

/** A fake socket whose `bufferedAmount` the test controls; resync() mimics Connection (welcome at `snapTick`). */
class FakeMember implements RoomMember {
  welcomeTick: number | undefined = 0;
  paused = false;
  bufferedAmount = 0;
  readonly sent: string[] = [];
  resyncs = 0;
  constructor(private readonly snapTick: () => number) {}
  send(frame: string | Uint8Array): void { this.sent.push(typeof frame === 'string' ? frame : `delta:${(decodeWire(frame) as { tick: number }).tick}`); }
  resync(): void {
    this.resyncs++;
    this.welcomeTick = undefined;
    this.sent.push('welcome:resync');
    this.welcomeTick = this.snapTick();
    this.paused = false;
  }
}

function setup() {
  let sub!: PlanetSubscriber;
  const planets = { subscribe: (_id: string, s: PlanetSubscriber) => { sub = s; return () => undefined; } } as unknown as GamePlanets;
  const rooms = new PlanetRooms(planets);
  let tick = 0;
  const m = new FakeMember(() => tick);
  rooms.join('pl', m);
  const delta = (to: number) => { tick = to; sub.onDelta!({ fromTick: to - 1, toTick: to, diff: new Uint8Array(1), events: [] }); };
  return { m, delta };
}

describe('WS-22 backpressure', () => {
  it('stops deltas above 1 MiB, resyncs once below 256 KiB, then resumes after the snapshot tick', () => {
    const { m, delta } = setup();
    delta(1);
    expect(m.sent).toHaveLength(1);

    m.bufferedAmount = BACKPRESSURE_HIGH + 1;
    delta(2); delta(3);
    expect(m.paused).toBe(true);
    expect(m.sent).toHaveLength(1);

    m.bufferedAmount = BACKPRESSURE_LOW + 1; // draining but not yet low enough
    delta(4);
    expect(m.resyncs).toBe(0);
    expect(m.sent).toHaveLength(1);

    m.bufferedAmount = BACKPRESSURE_LOW - 1;
    delta(5); // triggers the resync; its snapshot is at tick 5, so this delta is covered by it
    expect(m.resyncs).toBe(1);
    expect(m.sent.slice(1)).toEqual(['welcome:resync']);
    expect(m.paused).toBe(false);

    delta(6);
    expect(m.sent).toHaveLength(3);
    expect(m.sent[2]).toBe('delta:6');
  });

  it('keeps below-threshold sockets untouched', () => {
    const { m, delta } = setup();
    m.bufferedAmount = BACKPRESSURE_HIGH;
    delta(1); delta(2);
    expect(m.sent).toHaveLength(2);
    expect(m.paused).toBe(false);
  });
});
