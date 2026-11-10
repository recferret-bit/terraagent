import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { CLOSE_CODES, encodeWire } from '@terra/contracts';
import type { Logger } from 'pino';
import { Counter, Gauge, type Registry } from 'prom-client';
import { WebSocketServer } from 'ws';
import { corsOrigin } from '../core/cors';
import type { EventBus } from '../bus/event-bus';
import type { MarketBookBusEvent } from '../market/api/market-book-push.service';
import type { MarketTradeBusEvent } from '../market/settlement/trade-settlement.service';
import type { NearCargoStatusBusEvent } from '../near/cargo/cargo-status.service';
import type { NearDeedUpdatedBusEvent } from '../near/deed/deed-mint-outbox.service';
import type { AppEnv } from '../core/tokens';
import type { GamePlanets } from '../game/game-planets.service';
import { presenceClosed, presenceJoined } from '../game/presence/planet-mode';
import type { PresenceTracker } from '../game/presence/tracker';
import type { CommandIngress } from './command-ingress';
import { Connection, type ConnectionDeps } from './connection';
import type { HomeProvider } from './home-provider';
import { PlayingSockets } from './playing-sockets';
import { PlanetRooms } from './rooms';
import type { SessionVerifier } from './session-verifier';

export const WS_PATH = '/ws';

export interface GatewayOptions {
  readonly env: Pick<AppEnv, 'CORS_ORIGINS' | 'NODE_ENV'>;
  readonly planets: GamePlanets;
  readonly verifier: SessionVerifier;
  readonly ingress: CommandIngress;
  readonly home?: HomeProvider;
  readonly digests?: ConnectionDeps['digests'];
  readonly flags: readonly string[];
  readonly seatDevScenario?: ConnectionDeps['seatDevScenario'];
  readonly log: Logger;
  readonly registry: Registry;
  readonly helloTimeoutMs: number;
  readonly idleTimeoutMs: number;
  readonly bus?: EventBus;
  /** In-memory away timer (CT-10). Absent in gateway unit fixtures that do not boot the game module. */
  readonly presence?: PresenceTracker;
}

/** `/ws` upgrade handling, origin allow-list, connection registry and one playing socket per colony (CT-41). */
export class WsGateway {
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, perMessageDeflate: { threshold: 1024 } });
  private readonly conns = new Set<Connection>();
  private readonly playing = new PlayingSockets();
  private readonly rooms: PlanetRooms;
  private readonly originOk: ReturnType<typeof corsOrigin>;
  private readonly welcomes: Counter;
  private detach: (() => void) | undefined;
  private readonly unwarp: () => void;
  private readonly undown: () => void;
  private readonly uncargo: (() => void) | undefined;
  private readonly undeed: (() => void) | undefined;
  private readonly unmarket: (() => void) | undefined;
  private readonly unbook: (() => void) | undefined;
  private readonly presenceIds = new WeakMap<Connection, string>();
  private presenceSeq = 0;

  constructor(private readonly o: GatewayOptions) {
    this.rooms = new PlanetRooms(o.planets);
    this.originOk = corsOrigin(o.env);
    this.unwarp = o.planets.onWarp((planetId, k) => this.rooms.broadcast(planetId, encodeWire({
      v: 1, t: 'event', tick: 0, d: { kind: 'dev.warp', severity: 'info', atTick: 0, colonyIds: [], data: { k } },
    })));
    // BE-11/BE-12: a planet whose thread died or whose step threw gets no more deltas; its sockets reconnect and rejoin.
    this.undown = o.planets.onPlanetDown((planetId) => {
      for (const c of [...this.conns]) if (c.planetId === planetId) c.bye(CLOSE_CODES.server_restarting, 'planet_down');
    });
    this.uncargo = o.bus?.on('near.cargo.status', (ev) => this.broadcastCargoStatus(ev), { module: 'WsGateway' });
    this.undeed = o.bus?.on('near.deed.updated', (ev) => this.broadcastDeedUpdated(ev), { module: 'WsGateway' });
    this.unmarket = o.bus?.on('market.trade', (ev: MarketTradeBusEvent) => this.rooms.broadcastMarket(ev.planetId, ev.payload.trade.pair, encodeWire({ v: 1, t: 'market.trade', d: ev.payload })), { module: 'WsGateway' });
    // Per-socket market topics (LED-25): a socket gets the pairs it subscribed to, or all pairs if it never subscribed.
    this.unbook = o.bus?.on('market.book', (ev: MarketBookBusEvent) => this.rooms.broadcastMarket(ev.planetId, ev.payload.pair, encodeWire({ v: 1, t: 'market.book', d: ev.payload })), { module: 'WsGateway' });
    const conns = this.conns;
    new Gauge({ name: 'ta_ws_connections', help: 'Open WebSocket connections', registers: [o.registry], collect() { this.set(conns.size); } });
    this.welcomes = new Counter({ name: 'ta_planet_ws_welcome_total', help: 'welcome messages sent', registers: [o.registry] });
  }

  get connections(): number {
    return this.conns.size;
  }

  attach(server: Server): void {
    const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => this.upgrade(req, socket, head);
    server.on('upgrade', onUpgrade);
    this.detach = () => server.off('upgrade', onUpgrade);
  }

  private upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const path = (req.url ?? '').split('?')[0];
    if (path !== WS_PATH) return refuse(socket, '404 Not Found');
    this.originOk(req.headers.origin, (_err, allow) => {
      if (!allow) return refuse(socket, '403 Forbidden');
      this.wss.handleUpgrade(req, socket, head, (ws) => this.accept(ws));
    });
  }

  private accept(ws: import('ws').WebSocket): void {
    const deps: ConnectionDeps = {
      verifier: this.o.verifier, planets: this.o.planets, rooms: this.rooms, ingress: this.o.ingress, home: this.o.home, digests: this.o.digests, flags: this.o.flags,
      seatDevScenario: this.o.seatDevScenario,
      log: this.o.log, helloTimeoutMs: this.o.helloTimeoutMs, idleTimeoutMs: this.o.idleTimeoutMs,
      onWelcome: () => this.welcomes.inc(),
      // Join is recorded before replaceOlder: its `bye 4001` is a close, and this join must cancel that timer.
      onJoined: (c) => { this.notePresenceJoin(c); this.replaceOlder(c); },
      onClosed: (c) => {
        this.conns.delete(c);
        this.playing.forget(c);
        this.notePresenceClose(c);
      },
    };
    this.conns.add(new Connection(ws, deps));
  }

  private presenceId(c: Connection): string {
    let id = this.presenceIds.get(c);
    if (!id) { id = `s${++this.presenceSeq}`; this.presenceIds.set(c, id); }
    return id;
  }

  /** `leaveRoom` clears colonyId before `onClosed`, so the colony is captured here, at welcome. */
  private notePresenceJoin(c: Connection): void {
    const presence = this.o.presence;
    if (!presence || !c.playerId || !c.planetId || !c.colonyId) return;
    const planetId = c.planetId;
    const id = this.presenceId(c);
    const session = { socketId: id, planetId, colonyId: c.colonyId, playerId: c.playerId, colonyIndex: c.colonyIndex };
    presenceJoined(presence, this.planetModes(), id, planetId, () => presence.join(session));
  }

  /** `leaveRoom` has already cleared `planetId`. The tracker still knows which planet the socket was on. */
  private notePresenceClose(c: Connection): void {
    const presence = this.o.presence;
    if (!presence) return;
    const id = this.presenceId(c);
    presenceClosed(presence, this.planetModes(), id, () => presence.close(id));
  }

  private planetModes() {
    const planets = this.o.planets;
    return { setMode: (planetId: string, mode: 'active' | 'coarse') => { planets.setMode(planetId, mode); } };
  }

  /** The new welcome is already sent. Close the older socket for this colony with 4001. */
  private replaceOlder(c: Connection): void {
    this.playing.replace(c);
  }

  private broadcastCargoStatus(ev: NearCargoStatusBusEvent): void {
    const frame = encodeWire({ v: 1, t: 'cargo.status', d: ev.status });
    if (ev.planetId) this.rooms.broadcast(ev.planetId, frame);
    for (const c of this.conns) {
      if (ev.planetId && c.planetId === ev.planetId && c.welcomeTick !== undefined) continue;
      if (
        !ev.planetId ||
        (ev.playerId && c.playerId === ev.playerId) ||
        (c.colonyId && c.colonyId === ev.colonyId) ||
        c.session?.dev
      ) {
        c.send(frame);
      }
    }
  }

  private broadcastDeedUpdated(ev: NearDeedUpdatedBusEvent): void {
    const frame = encodeWire({ v: 1, t: 'deed.updated', d: ev.payload });
    if (ev.planetId) this.rooms.broadcast(ev.planetId, frame);
    for (const c of this.conns) {
      if (ev.planetId && c.planetId === ev.planetId && c.welcomeTick !== undefined) continue;
      if (
        !ev.planetId ||
        (ev.playerId && c.playerId === ev.playerId) ||
        (c.colonyId && c.colonyId === ev.colonyId) ||
        c.session?.dev
      ) {
        c.send(frame);
      }
    }
  }

  /** Shutdown: `bye 4012` to everyone, then wait briefly for the closing handshakes. Must run before the sim threads stop. */
  async closeAll(graceMs = 1000): Promise<void> {
    this.detach?.();
    this.unwarp();
    this.undown();
    this.uncargo?.();
    this.undeed?.();
    this.unmarket?.();
    this.unbook?.();
    const all = [...this.conns];
    for (const c of all) c.bye(CLOSE_CODES.server_restarting, 'server_restarting');
    this.o.presence?.stop();
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => { for (const c of all) c.terminate(); resolve(); }, graceMs);
      const poll = setInterval(() => {
        if (this.wss.clients.size === 0) { clearTimeout(t); clearInterval(poll); resolve(); }
      }, 10);
      poll.unref();
    });
    this.wss.close();
  }
}

function refuse(socket: Duplex, status: string): void {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}
