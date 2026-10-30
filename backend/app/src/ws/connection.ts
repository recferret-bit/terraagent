import type { Logger } from 'pino';
import { ClientMessage, CLOSE_CODES, decodeWire, encodeWire, PlanetType, type ClientMessageOf, type CloseCode } from '@terra/contracts';
import type { RawData, WebSocket } from 'ws';
import type { FullState, GamePlanets } from '../game/game-planets.service';
import type { CommandIngress } from './command-ingress';
import type { PlanetRooms, RoomMember } from './rooms';
import type { SessionVerifier } from './session-verifier';

export const TICK_MS = 200;
export const PROTO_VERSION = 1;

export interface ConnectionDeps {
  readonly verifier: SessionVerifier;
  readonly planets: GamePlanets;
  readonly rooms: PlanetRooms;
  readonly ingress: CommandIngress;
  readonly flags: readonly string[];
  readonly log: Logger;
  readonly helloTimeoutMs: number;
  readonly idleTimeoutMs: number;
  /** Called after the welcome of a join was sent; the gateway closes the player's older planet socket with 4001. */
  onJoined(conn: Connection): void;
  onClosed(conn: Connection): void;
  onWelcome(): void;
}

type State = 'new' | 'lobby' | 'joining' | 'playing' | 'closed';

const rawToFrame = (data: RawData, isBinary: boolean): string | Uint8Array => {
  const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data);
  return isBinary ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) : buf.toString('utf8');
};

/**
 * One WebSocket: hello (5 s) -> lobby -> join -> playing (PROTOCOL §4.1, WS-10..16). Frames are handled one at a time
 * so a `join` waiting for the engine snapshot cannot interleave with the next frame.
 *
 * Invalid frames: before `hello` they close the socket with 4000 (WS-10). After `hello` they are logged and ignored,
 * because 4000 means "bad hello" and a reconnecting client would only loop.
 */
export class Connection implements RoomMember {
  state: State = 'new';
  playerId: string | undefined;
  planetId: string | undefined;
  welcomeTick: number | undefined;
  paused = false;
  private resyncing = false;
  private chain: Promise<void> = Promise.resolve();
  private helloTimer: NodeJS.Timeout | undefined;
  private idleTimer: NodeJS.Timeout | undefined;

  constructor(private readonly ws: WebSocket, private readonly d: ConnectionDeps) {
    this.helloTimer = setTimeout(() => this.bye(CLOSE_CODES.bad_hello, 'hello_timeout'), d.helloTimeoutMs);
    this.touch();
    ws.on('message', (data, isBinary) => {
      this.touch();
      const frame = rawToFrame(data, isBinary);
      this.chain = this.chain.then(() => this.onFrame(frame)).catch((e) => this.d.log.error({ err: e, playerId: this.playerId }, 'ws frame handler failed'));
    });
    ws.on('close', () => this.dispose());
    ws.on('error', (e) => this.d.log.debug({ err: e }, 'ws socket error'));
  }

  send(frame: string | Uint8Array): void {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(frame);
  }

  get bufferedAmount(): number {
    return this.ws.bufferedAmount;
  }

  /** WS-22: replaces the deltas a backed-up socket missed with a fresh engine snapshot; deltas resume after its tick. */
  resync(): void {
    if (this.resyncing || this.state !== 'playing' || !this.planetId) return;
    this.resyncing = true;
    const planetId = this.planetId;
    this.welcomeTick = undefined; // no deltas until the snapshot is out
    this.d.planets.fullState(planetId).then(
      (snap) => {
        if (this.state !== 'playing' || this.planetId !== planetId) return;
        this.sendWelcome('resync', planetId, snap);
        this.welcomeTick = snap.tick;
      },
      (e) => { this.d.log.error({ err: e, planetId }, 'resync fullState failed'); this.bye(CLOSE_CODES.forbidden, 'planet_unavailable'); },
    ).finally(() => { this.resyncing = false; this.paused = false; });
  }

  sendMsg(msg: object): void {
    this.send(encodeWire(msg));
  }

  /** Sends `bye {code, reason}` and closes with the same code. */
  bye(code: CloseCode, reason: string): void {
    if (this.state === 'closed') return;
    this.sendMsg({ v: 1, t: 'bye', d: { code, reason } });
    this.ws.close(code, reason);
    this.dispose();
  }

  /** Forcefully drops the transport (shutdown fallback). */
  terminate(): void {
    this.ws.terminate();
  }

  private touch(): void {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.state === 'closed') return;
      this.ws.close(CLOSE_CODES.going_away, 'idle');
      this.dispose();
    }, this.d.idleTimeoutMs);
  }

  private dispose(): void {
    if (this.state === 'closed') return;
    this.state = 'closed';
    clearTimeout(this.helloTimer);
    clearTimeout(this.idleTimer);
    this.leaveRoom();
    this.d.onClosed(this);
  }

  private leaveRoom(): void {
    if (this.planetId) this.d.rooms.leave(this.planetId, this);
    this.planetId = undefined;
    this.welcomeTick = undefined;
  }

  private parse(frame: string | Uint8Array): ClientMessage | undefined {
    try {
      const r = ClientMessage.safeParse(decodeWire(frame));
      if (r.success) return r.data;
      this.d.log.debug({ issues: r.error.issues.slice(0, 3) }, 'invalid ws frame');
    } catch {
      this.d.log.debug('undecodable ws frame');
    }
    return undefined;
  }

  private async onFrame(frame: string | Uint8Array): Promise<void> {
    if (this.state === 'closed') return;
    const msg = this.parse(frame);
    if (this.state === 'new') {
      if (msg?.t !== 'hello') return this.bye(CLOSE_CODES.bad_hello, 'expected_hello');
      return this.onHello(msg);
    }
    if (!msg) return; // ignored, see class comment
    switch (msg.t) {
      case 'ping':
        return this.sendMsg({ v: 1, t: 'pong', d: { clientTimeMs: msg.d.clientTimeMs, serverTimeMs: Date.now() } });
      case 'join': return this.onJoin(msg);
      case 'leave': return this.onLeave();
      case 'cmd': return this.onCmd(msg);
      default: this.d.log.debug({ t: msg.t }, 'ws message not supported yet');
    }
  }

  private async onHello(msg: ClientMessageOf<'hello'>): Promise<void> {
    if (!msg.d.proto.includes(PROTO_VERSION)) return this.bye(CLOSE_CODES.bad_hello, 'unsupported_proto');
    try {
      this.playerId = (await this.d.verifier.verify(msg.d.accessToken)).playerId;
    } catch {
      return this.bye(CLOSE_CODES.bad_hello, 'bad_token');
    }
    if (this.state !== 'new') return; // closed while verifying
    clearTimeout(this.helloTimer);
    this.state = 'lobby';
    this.sendMsg({ v: 1, t: 'ready', d: { playerId: this.playerId, flags: this.d.flags } });
  }

  private onLeave(): void {
    if (this.state === 'playing') this.leaveRoom();
    if (this.state !== 'closed') this.state = 'lobby';
  }

  private async onJoin(msg: ClientMessageOf<'join'>): Promise<void> {
    const planetId = msg.d.planetId;
    if (this.state === 'playing') this.leaveRoom();
    // W00: any loaded planet may be joined; a later wave enforces "own live colony" (WS-12).
    if (!this.d.planets.isLoaded(planetId)) return this.bye(CLOSE_CODES.forbidden, 'forbidden');
    this.state = 'joining';
    this.planetId = planetId;
    this.d.rooms.join(planetId, this);
    let snap;
    try {
      snap = await this.d.planets.fullState(planetId);
    } catch (e) {
      this.d.log.error({ err: e, planetId }, 'fullState failed');
      return this.bye(CLOSE_CODES.forbidden, 'planet_unavailable');
    }
    if (this.state !== 'joining') return; // closed or left meanwhile
    this.sendWelcome('join', planetId, snap);
    this.welcomeTick = snap.tick;
    this.state = 'playing';
    this.d.onWelcome();
    this.d.onJoined(this);
  }

  private sendWelcome(reason: 'join' | 'resync', planetId: string, snap: FullState): void {
    const type = PlanetType.safeParse(snap.planetType);
    this.sendMsg({
      v: 1, t: 'welcome', tick: snap.tick,
      d: {
        reason, colonyId: null,
        planet: { id: planetId, type: type.success ? type.data : 'temperate', name: planetId },
        state: snap.bytes, simVersion: snap.simVersion, dataHash: snap.dataHash, tick: snap.tick,
        ...(snap.overrides && Object.keys(snap.overrides).length ? { overrides: snap.overrides } : {}),
        serverTimeMs: Date.now(), tickMs: TICK_MS, deltaHz: this.d.planets.deltaHz, flags: this.d.flags,
      },
    });
  }

  private async onCmd(msg: ClientMessageOf<'cmd'>): Promise<void> {
    if (this.state !== 'playing' || !this.playerId || !this.planetId) {
      return this.sendMsg({ v: 1, t: 'cmd.reject', d: { id: msg.id, code: 'internal', detail: 'not joined' } });
    }
    await this.d.ingress.handle({ playerId: this.playerId, planetId: this.planetId, reply: (m) => this.sendMsg(m) }, msg);
  }
}
