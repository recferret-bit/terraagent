import { encodeWire, hasEventKind } from '@terra/contracts';
import type { GamePlanets, PlanetSubscriber } from '../game/game-planets.service';

/** A socket as a room sees it. */
export interface RoomMember {
  /** Tick of the welcome snapshot once sent; deltas at or before it are skipped. Undefined while the welcome is pending. */
  welcomeTick: number | undefined;
  send(frame: string | Uint8Array): void;
}

interface Room { readonly members: Set<RoomMember>; readonly unsubscribe: () => void }

/** Per-planet socket sets plus one thread subscription per planet: deltas/events are encoded once and fanned out. */
export class PlanetRooms {
  private readonly rooms = new Map<string, Room>();

  constructor(private readonly planets: GamePlanets) {}

  join(planetId: string, m: RoomMember): void {
    let room = this.rooms.get(planetId);
    if (!room) {
      const members = new Set<RoomMember>();
      room = { members, unsubscribe: this.planets.subscribe(planetId, this.fanout(members)) };
      this.rooms.set(planetId, room);
    }
    room.members.add(m);
  }

  /** Removes the socket; the planet is unsubscribed from its thread when the last socket leaves. */
  leave(planetId: string, m: RoomMember): void {
    const room = this.rooms.get(planetId);
    if (!room?.members.delete(m)) return;
    if (room.members.size === 0) { this.rooms.delete(planetId); room.unsubscribe(); }
  }

  size(planetId: string): number {
    return this.rooms.get(planetId)?.members.size ?? 0;
  }

  private fanout(members: Set<RoomMember>): PlanetSubscriber {
    const send = (frame: string | Uint8Array, minTick: number) => {
      for (const m of members) if (m.welcomeTick !== undefined && minTick > m.welcomeTick) m.send(frame);
    };
    return {
      onDelta: (d) => {
        if (members.size === 0) return;
        send(encodeWire({ v: 1, t: 'delta', tick: d.toTick, d: { fromTick: d.fromTick, toTick: d.toTick, diff: d.diff, events: d.events } }), d.toTick);
      },
      onEvent: (events) => {
        // Until the delta builder fills `delta`, the thread sends bare events: forward the kinds the contract knows.
        for (const e of events) if (hasEventKind(e.kind)) send(encodeWire({ v: 1, t: 'event', tick: e.atTick, d: e }), e.atTick);
      },
    };
  }
}
