import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { CLOSE_CODES, encodeWire } from '@terra/contracts';
import type { Logger } from 'pino';
import { Counter, Gauge, type Registry } from 'prom-client';
import { WebSocketServer } from 'ws';
import { corsOrigin } from '../core/cors';
import type { AppEnv } from '../core/tokens';
import type { GamePlanets } from '../game/game-planets.service';
import type { CommandIngress } from './command-ingress';
import { Connection, type ConnectionDeps } from './connection';
import { PlanetRooms } from './rooms';
import type { SessionVerifier } from './session-verifier';

export const WS_PATH = '/ws';

export interface GatewayOptions {
  readonly env: Pick<AppEnv, 'CORS_ORIGINS' | 'NODE_ENV'>;
  readonly planets: GamePlanets;
  readonly verifier: SessionVerifier;
  readonly ingress: CommandIngress;
  readonly flags: readonly string[];
  readonly log: Logger;
  readonly registry: Registry;
  readonly helloTimeoutMs: number;
  readonly idleTimeoutMs: number;
}

/** `/ws` upgrade handling, origin allow-list, connection registry and the one-planet-socket-per-player rule (WS-13). */
export class WsGateway {
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, perMessageDeflate: { threshold: 1024 } });
  private readonly conns = new Set<Connection>();
  private readonly byPlayer = new Map<string, Connection>();
  private readonly rooms: PlanetRooms;
  private readonly originOk: ReturnType<typeof corsOrigin>;
  private readonly welcomes: Counter;
  private detach: (() => void) | undefined;
  private readonly unwarp: () => void;

  constructor(private readonly o: GatewayOptions) {
    this.rooms = new PlanetRooms(o.planets);
    this.originOk = corsOrigin(o.env);
    this.unwarp = o.planets.onWarp((planetId, k) => this.rooms.broadcast(planetId, encodeWire({
      v: 1, t: 'event', tick: 0, d: { kind: 'dev.warp', severity: 'info', atTick: 0, colonyIds: [], data: { k } },
    })));
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
      verifier: this.o.verifier, planets: this.o.planets, rooms: this.rooms, ingress: this.o.ingress, flags: this.o.flags,
      log: this.o.log, helloTimeoutMs: this.o.helloTimeoutMs, idleTimeoutMs: this.o.idleTimeoutMs,
      onWelcome: () => this.welcomes.inc(),
      onJoined: (c) => this.replaceOlder(c),
      onClosed: (c) => {
        this.conns.delete(c);
        if (c.playerId && this.byPlayer.get(c.playerId) === c) this.byPlayer.delete(c.playerId);
      },
    };
    this.conns.add(new Connection(ws, deps));
  }

  /** The new welcome is already sent: close the player's previous planet socket with 4001. */
  private replaceOlder(c: Connection): void {
    if (!c.playerId) return;
    const older = this.byPlayer.get(c.playerId);
    this.byPlayer.set(c.playerId, c);
    if (older && older !== c) older.bye(CLOSE_CODES.replaced, 'replaced');
  }

  /** Shutdown: `bye 4012` to everyone, then wait briefly for the closing handshakes. Must run before the sim threads stop. */
  async closeAll(graceMs = 1000): Promise<void> {
    this.detach?.();
    this.unwarp();
    const all = [...this.conns];
    for (const c of all) c.bye(CLOSE_CODES.server_restarting, 'server_restarting');
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
