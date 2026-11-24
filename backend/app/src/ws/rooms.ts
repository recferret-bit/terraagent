import {
  encodeWire,
  hasEventKind,
  type AgentDecisionFeedItemV1,
  type SimInputFeedItemV1,
} from '@terra/contracts';
import type { Logger } from 'pino';
import { ownFramesFor, unpackDeltaBundle } from '@terra/sim';
import type { SectorAntiCheatService } from '../core/anticheat';
import type { InternalAuthEnv } from '../game/cluster/internal-auth';
import type { GamePlanets, PlanetSubscriber } from '../game/game-planets.service';
import { subscribeRemotePlanetStream } from './parts/cluster-relay';

export interface RemoteRoomSubscription {
  readonly internalUrl: string;
  readonly env: InternalAuthEnv;
  readonly onSimFeeds: (tick: number, inputs: readonly SimInputFeedItemV1[], decisions: readonly AgentDecisionFeedItemV1[]) => void;
  readonly onWarp: (k: number) => void;
  readonly onDown: () => void;
  readonly log?: Logger;
}

/** A socket as a room sees it. */
export interface RoomMember {
  /** Tick of the welcome snapshot once sent; deltas at or before it are skipped. Undefined while the welcome is pending. */
  welcomeTick: number | undefined;
  /**
   * The socket's own colony: it gets that colony's owner-field frames with each delta. Undefined (spectator, a session
   * without a colony, a dev session): every colony's frames (the full view).
   */
  readonly deltaColony?: number;
  send(frame: string | Uint8Array): void;
  /** Bytes queued on the socket and not yet flushed (`ws.bufferedAmount`). */
  readonly bufferedAmount: number;
  /** True from the moment the socket backed up until its resync welcome went out; the room sends it nothing meanwhile. */
  paused: boolean;
  /** Per-socket market topic filter (LED-25): absent = every pair of the planet (a socket that never subscribed). */
  wantsMarketPair?(pair: string): boolean;
  /** Sends a fresh `welcome {reason:'resync'}` and sets `welcomeTick`; must set `paused = false` when done (or on failure). */
  resync(): void;
}

/** WS-22: stop sending deltas above this backlog... */
export const BACKPRESSURE_HIGH = 1024 * 1024;
/** ...and resync once it drained below this. */
export const BACKPRESSURE_LOW = 256 * 1024;

interface Room { readonly members: Set<RoomMember>; readonly unsubscribe: () => void }

/** Per-planet socket sets plus one thread subscription per planet: deltas/events are encoded once and fanned out. */
export class PlanetRooms {
  private readonly rooms = new Map<string, Room>();

  constructor(
    private readonly planets: GamePlanets,
    private readonly antiCheat?: Pick<SectorAntiCheatService, 'applyPlanetDelta' | 'applyPlanetEvents'>,
  ) {}

  join(planetId: string, m: RoomMember, remote?: RemoteRoomSubscription): void {
    let room = this.rooms.get(planetId);
    if (!room) {
      const members = new Set<RoomMember>();
      const subscriber = this.fanout(planetId, members);
      let created: Room | undefined;
      const onRemoteDown = () => {
        if (created && this.rooms.get(planetId) === created) {
          this.rooms.delete(planetId);
          try {
            created.unsubscribe();
          } catch {
            // ignore
          }
        }
        remote?.onDown();
      };
      const unsubscribe = remote
        ? subscribeRemotePlanetStream({
            internalUrl: remote.internalUrl,
            planetId,
            env: remote.env,
            subscriber,
            onSimFeeds: remote.onSimFeeds,
            onWarp: remote.onWarp,
            onDown: onRemoteDown,
            log: remote.log,
          })
        : this.planets.subscribe(planetId, subscriber);
      room = created = { members, unsubscribe };
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

  /** Sends one already-encoded frame to every joined socket of the planet (host-level notices such as `dev.warp`). */
  broadcast(planetId: string, frame: string | Uint8Array): void {
    for (const m of this.rooms.get(planetId)?.members ?? []) if (m.welcomeTick !== undefined && this.writable(m)) m.send(frame);
  }

  /** Like `broadcast`, for a `market.*` push of one pair: only sockets subscribed to that pair (or never subscribed) get it. */
  broadcastMarket(planetId: string, pair: string, frame: string | Uint8Array): void {
    for (const m of this.rooms.get(planetId)?.members ?? []) {
      if (m.welcomeTick !== undefined && (m.wantsMarketPair?.(pair) ?? true) && this.writable(m)) m.send(frame);
    }
  }

  size(planetId: string): number {
    return this.rooms.get(planetId)?.members.size ?? 0;
  }

  /** WS-22 backpressure: a backed-up socket gets nothing until it drained, then a resync welcome replaces what it missed. */
  private writable(m: RoomMember): boolean {
    if (m.paused) {
      if (m.bufferedAmount < BACKPRESSURE_LOW) m.resync();
      return false;
    }
    if (m.bufferedAmount > BACKPRESSURE_HIGH) { m.paused = true; return false; }
    return true;
  }

  private fanout(planetId: string, members: Set<RoomMember>): PlanetSubscriber {
    const send = (frame: string | Uint8Array, minTick: number) => {
      for (const m of members) if (m.welcomeTick !== undefined && minTick > m.welcomeTick && this.writable(m)) m.send(frame);
    };
    return {
      onDelta: (d) => {
        this.antiCheat?.applyPlanetDelta(planetId, d.diff, d.events);
        if (members.size === 0) return;
        const frame = deltaVariants(d);
        for (const m of members) {
          if (m.welcomeTick !== undefined && d.toTick > m.welcomeTick && this.writable(m)) m.send(frame(m.deltaColony));
        }
      },
      onEvent: (events) => {
        this.antiCheat?.applyPlanetEvents(planetId, events);
        // Until the delta builder fills `delta`, the thread sends bare events: forward the kinds the contract knows.
        for (const e of events) if (hasEventKind(e.kind)) send(encodeWire({ v: 1, t: 'event', tick: e.atTick, d: e }), e.atTick);
      },
      // the planet moved to another sim thread (rebalancing): every welcomed socket gets a fresh `welcome {reason:'resync'}`
      onResync: () => { for (const m of members) if (m.welcomeTick !== undefined) m.resync(); },
    };
  }
}

/**
 * A host delta (a plain diff, or a bundle with per-colony own frames) as one encoded `delta` message per viewer kind:
 * each colony's sockets share one frame, full viewers another; every frame is encoded once per delta.
 */
export function deltaVariants(d: { fromTick: number; toTick: number; diff: Uint8Array; events: readonly unknown[] }): (colony: number | undefined) => string | Uint8Array {
  const { diff, own } = unpackDeltaBundle(d.diff);
  const cache = new Map<number | 'all', string | Uint8Array>();
  return (colony) => {
    const key = colony ?? 'all';
    let frame = cache.get(key);
    if (frame === undefined) {
      const frames = ownFramesFor(own, colony);
      frame = encodeWire({ v: 1, t: 'delta', tick: d.toTick, d: { fromTick: d.fromTick, toTick: d.toTick, diff, ...(frames.length ? { own: frames } : {}), events: d.events } });
      cache.set(key, frame);
    }
    return frame;
  };
}
