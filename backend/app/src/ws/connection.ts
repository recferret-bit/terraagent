import type { Logger } from 'pino';
import { ClientMessage, CLOSE_CODES, decodeWire, encodeWire, PlanetType, type AwayDigestV1, type ClientMessageOf, type CloseCode, type HomeResponse } from '@terra/contracts';
import type { RawData, WebSocket } from 'ws';
import type { AwayDigestService } from '../game/digest';
import type { FullState, GamePlanets } from '../game/game-planets.service';
import { holdColonySocket, releaseColonySocket } from '../game/presence/socket-presence';
import type { CommandIngress } from './command-ingress';
import { DEFAULT_HOME, type HomeProvider } from './home-provider';
import { MarketTopics } from './market-topics';
import type { PlanetRooms, RoomMember } from './rooms';
import { BadHelloTokenError, type SessionVerifier, type VerifiedSession } from './session-verifier';
import { welcomeFields } from './welcome-digest';

export const TICK_MS = 200;
export const PROTO_VERSION = 1;

export interface ConnectionDeps {
  readonly verifier: SessionVerifier;
  readonly planets: GamePlanets;
  readonly rooms: PlanetRooms;
  readonly ingress: CommandIngress;
  readonly home?: HomeProvider;
  /** Closed away digest for `welcome.away` (CT-32). Absent in gateway fixtures that do not boot digests. */
  readonly digests?: Pick<AwayDigestService, 'deliverWelcome'>;
  readonly flags: readonly string[];
  readonly log: Logger;
  readonly helloTimeoutMs: number;
  readonly idleTimeoutMs: number;
  /**
   * Dev scenario join: write the player and colony 0 so a later social login can attach the colony deposit.
   * Absent in unit tests that have no database.
   */
  seatDevScenario?(input: { playerId: string; handle: string; planetId: string; colonyIndices?: readonly number[] }): Promise<void>;
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
  session: VerifiedSession | undefined;
  playerId: string | undefined;
  planetId: string | undefined;
  colonyId: string | null = null;
  /** Colony index from home, when the row has one. The presence command carries it (W09-28 owns takeover). */
  colonyIndex: number | undefined;
  welcomeTick: number | undefined;
  paused = false;
  /** W13 per-socket market pair filter; reset to "all pairs" whenever the socket leaves its planet. */
  private readonly market = new MarketTopics();
  private resyncing = false;
  /** Per-socket colony-lookup memo for the ingress (BE-09); reset when the socket leaves its planet. */
  private readonly colonyMemo: { planetId?: string; colony?: null } = {};
  /** This socket has incremented the colony presence refcount (CT-38). Released once in `leaveRoom`. */
  private colonyHeld = false;
  private chain: Promise<void> = Promise.resolve();
  private helloTimer: NodeJS.Timeout | undefined;
  private idleTimer: NodeJS.Timeout | undefined;
  private expTimer: NodeJS.Timeout | undefined;

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

  wantsMarketPair(pair: string): boolean {
    return this.market.wants(pair);
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
    clearTimeout(this.expTimer);
    this.leaveRoom();
    this.d.onClosed(this);
  }

  private armExpTimer(expSec: number | undefined): void {
    clearTimeout(this.expTimer);
    this.expTimer = undefined;
    if (typeof expSec !== 'number') return;
    const delayMs = Math.min(Math.max(0, expSec * 1000 - Date.now()), 2_147_483_647);
    this.expTimer = setTimeout(() => {
      if (this.state === 'closed') return;
      this.bye(CLOSE_CODES.forbidden, 'forbidden');
    }, delayMs);
    this.expTimer.unref?.();
  }

  /** Best-effort. A failure leaves the dev session on the synthetic colony 0 (BE-07). */
  private async seatScenario(planetId: string): Promise<void> {
    const seat = this.d.seatDevScenario;
    const playerId = this.playerId;
    if (!seat || !playerId || !this.session?.dev || !this.d.planets.isScenarioColonyPlanet(planetId)) return;
    try {
      await seat({ playerId, handle: this.session.handle ?? 'pilot', planetId, colonyIndices: this.d.planets.scenarioColonyIndices?.(planetId) ?? [0] });
    } catch (e) {
      this.d.log.warn({ err: e, playerId, planetId }, 'scenario colony seat failed');
    }
  }

  private async resolveHome(playerId: string, planetId?: string): Promise<HomeResponse> {
    if (!this.d.home) return DEFAULT_HOME;
    try {
      return await this.d.home.getHome(playerId, planetId);
    } catch (e) {
      this.d.log.warn({ err: e, playerId }, 'home lookup failed: answered as NEW (a join is refused until it works)');
      return DEFAULT_HOME;
    }
  }

  private leaveRoom(): void {
    this.releaseColony();
    if (this.planetId) this.d.rooms.leave(this.planetId, this);
    delete this.colonyMemo.planetId;
    delete this.colonyMemo.colony;
    this.planetId = undefined;
    this.market.reset();
    this.colonyId = null;
    this.colonyIndex = undefined;
    this.welcomeTick = undefined;
  }

  /** Holds presence only after `playing`, and before the previous socket of this player is closed. */
  private holdColony(): void {
    if (this.colonyHeld || !this.colonyId) return;
    holdColonySocket(this.colonyId);
    this.colonyHeld = true;
  }

  private releaseColony(): void {
    if (!this.colonyHeld) return;
    const id = this.colonyId;
    this.colonyHeld = false;
    if (id) releaseColonySocket(id);
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
      case 'reauth': return this.onReauth(msg);
      case 'join': return this.onJoin(msg);
      case 'leave': return this.onLeave();
      case 'market.subscribe': return this.onMarketTopic(() => this.market.subscribe(msg.d.pairs), msg.d.planetId);
      case 'market.unsubscribe': return this.onMarketTopic(() => this.market.unsubscribe(msg.d.pairs), msg.d.planetId);
      case 'cmd': return this.onCmd(msg);
      default: this.d.log.debug({ t: msg.t }, 'ws message not supported yet');
    }
  }

  /** Market topic changes apply to the joined planet only; any other state or planet is ignored. */
  private onMarketTopic(apply: () => void, planetId: string): void {
    if (this.state === 'playing' && this.planetId === planetId) apply();
  }

  private async onHello(msg: ClientMessageOf<'hello'>): Promise<void> {
    if (!msg.d.proto.includes(PROTO_VERSION)) return this.bye(CLOSE_CODES.bad_hello, 'unsupported_proto');
    let session: VerifiedSession | null;
    try {
      session = await this.d.verifier.verify(msg.d.accessToken);
    } catch (err) {
      if (err instanceof BadHelloTokenError) return this.bye(CLOSE_CODES.bad_hello, 'bad_token');
      return this.bye(CLOSE_CODES.forbidden, 'forbidden');
    }
    if (!session?.playerId) return this.bye(CLOSE_CODES.forbidden, 'forbidden');
    if (this.state !== 'new') return; // closed while verifying
    this.session = session;
    this.playerId = session.playerId;
    const home = await this.resolveHome(session.playerId);
    if (this.state !== 'new') return;
    clearTimeout(this.helloTimer);
    this.state = 'lobby';
    this.armExpTimer(session.exp);
    this.sendMsg({ v: 1, t: 'ready', d: { playerId: this.playerId, home, flags: this.d.flags } });
  }

  private async onReauth(msg: ClientMessageOf<'reauth'>): Promise<void> {
    let session: VerifiedSession | null;
    try {
      session = await this.d.verifier.verify(msg.d.accessToken);
    } catch {
      return this.bye(CLOSE_CODES.forbidden, 'forbidden');
    }
    if (!session?.playerId || session.playerId !== this.playerId) {
      return this.bye(CLOSE_CODES.forbidden, 'forbidden');
    }
    const home = await this.resolveHome(session.playerId, this.planetId ?? undefined);
    if (this.state === 'closed') return;
    this.session = session;
    this.armExpTimer(session.exp);
    this.sendMsg({ v: 1, t: 'ready', d: { playerId: session.playerId, home, flags: this.d.flags } });
  }

  private onLeave(): void {
    if (this.state === 'playing') this.leaveRoom();
    if (this.state !== 'closed') this.state = 'lobby';
  }

  /**
   * WS-12: a player joins only the planet of its own live (ACTIVE) colony, else `bye 4003`. A `dev:` session (never in
   * production) may join any loaded planet (`?scenario=` / `?join=` dev flows, BE-07).
   */
  private async onJoin(msg: ClientMessageOf<'join'>): Promise<void> {
    const planetId = msg.d.planetId;
    if (this.state === 'playing') this.leaveRoom();
    if (!this.d.planets.isLoaded(planetId)) return this.bye(CLOSE_CODES.forbidden, 'forbidden');
    this.state = 'joining';
    this.planetId = planetId;
    await this.seatScenario(planetId);
    const home = this.playerId ? await this.resolveHome(this.playerId, planetId) : DEFAULT_HOME;
    if (this.state !== 'joining') return; // closed or left meanwhile
    const own = home.state === 'ACTIVE' && home.colony.planetId === planetId;
    if (!own && !this.session?.dev) return this.bye(CLOSE_CODES.forbidden, 'not_your_planet');
    this.colonyId = own ? home.colony.id : null;
    this.colonyIndex = own ? home.colony.colonyIndex : undefined;
    this.d.rooms.join(planetId, this);
    let snap;
    try {
      snap = await this.d.planets.fullState(planetId);
    } catch (e) {
      this.d.log.error({ err: e, planetId }, 'fullState failed');
      return this.bye(CLOSE_CODES.forbidden, 'planet_unavailable');
    }
    if (this.state !== 'joining') return; // closed or left meanwhile
    const away = await this.readReturnDigest(snap.bytes);
    if (this.state !== 'joining') return;
    this.sendWelcome('join', planetId, snap, away);
    this.welcomeTick = snap.tick;
    this.state = 'playing';
    this.holdColony();
    this.d.onWelcome();
    this.d.onJoined(this);
  }

  private sendWelcome(reason: 'join' | 'resync', planetId: string, snap: FullState, away: AwayDigestV1 | null = null): void {
    const type = PlanetType.safeParse(snap.planetType);
    this.sendMsg({
      v: 1, t: 'welcome', tick: snap.tick,
      d: {
        reason, colonyId: this.colonyId,
        planet: { id: planetId, type: type.success ? type.data : 'temperate', name: planetId },
        state: snap.bytes, simVersion: snap.simVersion, dataHash: snap.dataHash, tick: snap.tick,
        ...(snap.overrides && Object.keys(snap.overrides).length ? { overrides: snap.overrides } : {}),
        serverTimeMs: Date.now(), tickMs: TICK_MS, deltaHz: this.d.planets.deltaHz, flags: this.d.flags,
        ...(snap.warp > 1 ? { warp: snap.warp } : {}),
        ...welcomeFields(reason, away),
      },
    });
  }

  /** Closes the open digest and takes it. A failure still lets the join welcome go out. */
  private async readReturnDigest(raw: Uint8Array): Promise<AwayDigestV1 | null> {
    const colonyId = this.colonyId;
    const digests = this.d.digests;
    if (!colonyId || !digests) return null;
    try {
      return await digests.deliverWelcome(colonyId, new Date(), raw);
    } catch (e) {
      this.d.log.warn({ err: e, colonyId }, 'away digest unread');
      return null;
    }
  }

  private async onCmd(msg: ClientMessageOf<'cmd'>): Promise<void> {
    if (this.state !== 'playing' || !this.playerId || !this.planetId) {
      return this.sendMsg({ v: 1, t: 'cmd.reject', d: { id: msg.id, code: 'internal', detail: 'not joined' } });
    }
    await this.d.ingress.handle({ playerId: this.playerId, planetId: this.planetId, dev: this.session?.dev === true, memo: this.colonyMemo, reply: (m) => this.sendMsg(m) }, msg);
  }
}
