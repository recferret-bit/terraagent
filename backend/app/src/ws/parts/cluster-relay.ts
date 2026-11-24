import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import {
  encodeWire,
  hasEventKind,
  type AgentDecisionFeedItemV1,
  type SimInputFeedItemV1,
} from '@terra/contracts';
import type { SimEvent } from '@terra/sim';
import type { Logger } from 'pino';
import WebSocket, { WebSocketServer } from 'ws';
import type { GamePlanets, PlanetSubscriber } from '../../game/game-planets.service';
import type { SimHistoryService } from '../../game/persistence/sim-history.service';
import { internalAuthHeaders, isValidInternalAuth, type InternalAuthEnv } from '../../game/cluster/internal-auth';

export const INTERNAL_WS_PATH = '/v1/internal/sim/ws';
export const MAX_RELAY_BUFFERED_BYTES = 16 * 1024 * 1024;

function safeRelaySend(ws: WebSocket, frame: string): boolean {
  if (ws.readyState !== WebSocket.OPEN) return false;
  if (ws.bufferedAmount > MAX_RELAY_BUFFERED_BYTES) {
    ws.close(1008, 'relay_backpressure');
    return false;
  }
  ws.send(frame);
  return true;
}

type RelayWireMsg =
  | { readonly t: 'delta'; readonly fromTick: number; readonly toTick: number; readonly diffB64: string; readonly events: SimEvent[] }
  | { readonly t: 'event'; readonly events: SimEvent[] }
  | {
      readonly t: 'sim.feeds';
      readonly tick: number;
      readonly inputs: readonly SimInputFeedItemV1[];
      readonly decisions: readonly AgentDecisionFeedItemV1[];
    }
  | { readonly t: 'warp'; readonly k: number }
  | { readonly t: 'resync' }
  | { readonly t: 'planet_down' };

export class InternalSimRelayServer {
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 });
  private readonly socketsByPlanet = new Map<string, Set<WebSocket>>();
  private readonly unsubFeeds: (() => void) | undefined;
  private readonly unsubExtraFeeds: (() => void) | undefined;
  private readonly unwarp: () => void;
  private readonly undown: () => void;
  private readonly ununload: (() => void) | undefined;

  constructor(
    private readonly planets: GamePlanets,
    private readonly env: InternalAuthEnv,
    private readonly onAllRelaysClosed: (planetId: string) => void,
    simHistory?: Pick<SimHistoryService, 'onExtraFeeds'>,
  ) {
    this.unsubFeeds = planets.onSimFeeds?.((planetId, tick, inputs, decisions) => {
      if (!this.hasWatchers(planetId)) return;
      this.sendPlanetJson(planetId, { t: 'sim.feeds', tick, inputs, decisions });
    });
    this.unsubExtraFeeds = simHistory?.onExtraFeeds?.((planetId, inputs, decisions) => {
      if (!this.hasWatchers(planetId)) return;
      const tick = inputs[0]?.atTick ?? decisions[0]?.atTick ?? 0;
      this.sendPlanetJson(planetId, { t: 'sim.feeds', tick, inputs, decisions });
    });
    this.unwarp = planets.onWarp((planetId, k) => {
      if (this.hasWatchers(planetId)) this.sendPlanetJson(planetId, { t: 'warp', k });
    });
    const evictPlanetRelays = (planetId: string) => {
      const set = this.socketsByPlanet.get(planetId);
      if (!set?.size) return;
      const frame = JSON.stringify({ t: 'planet_down' } satisfies RelayWireMsg);
      for (const ws of [...set]) {
        if (ws.readyState === WebSocket.OPEN) ws.send(frame);
        ws.close(1012, 'planet_down');
      }
      this.socketsByPlanet.delete(planetId);
    };
    this.undown = planets.onPlanetDown(evictPlanetRelays);
    this.ununload = planets.onPlanetUnloaded?.(evictPlanetRelays);
  }

  hasWatchers(planetId: string): boolean {
    return (this.socketsByPlanet.get(planetId)?.size ?? 0) > 0;
  }

  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    const rawUrl = req.url ?? '';
    const path = rawUrl.split('?')[0];
    if (path !== INTERNAL_WS_PATH) return false;
    if (!isValidInternalAuth(req.headers, this.env)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      socket.destroy();
      return true;
    }
    const url = new URL(rawUrl, 'http://127.0.0.1');
    const planetId = url.searchParams.get('planetId')?.trim() ?? '';
    if (!planetId || !this.planets.isLoaded(planetId)) {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      socket.destroy();
      return true;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => this.accept(ws, planetId));
    return true;
  }

  private accept(ws: WebSocket, planetId: string): void {
    let set = this.socketsByPlanet.get(planetId);
    if (!set) this.socketsByPlanet.set(planetId, (set = new Set()));
    set.add(ws);
    this.planets.setMode(planetId, 'active');

    const unsub = this.planets.subscribe(planetId, {
      onDelta: (d) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        const msg: RelayWireMsg = {
          t: 'delta',
          fromTick: d.fromTick,
          toTick: d.toTick,
          diffB64: Buffer.from(d.diff).toString('base64'),
          events: d.events,
        };
        safeRelaySend(ws, JSON.stringify(msg));
      },
      onEvent: (events) => {
        if (ws.readyState !== WebSocket.OPEN || !events.length) return;
        safeRelaySend(ws, JSON.stringify({ t: 'event', events } satisfies RelayWireMsg));
      },
      onResync: () => {
        if (ws.readyState !== WebSocket.OPEN) return;
        safeRelaySend(ws, JSON.stringify({ t: 'resync' } satisfies RelayWireMsg));
      },
    });

    ws.on('error', () => {
      // close fires right after and triggers unsub + onAllRelaysClosed
    });
    ws.on('close', () => {
      unsub();
      const s = this.socketsByPlanet.get(planetId);
      if (s?.delete(ws) && s.size === 0) {
        this.socketsByPlanet.delete(planetId);
        this.onAllRelaysClosed(planetId);
      }
    });
  }

  private sendPlanetJson(planetId: string, msg: RelayWireMsg): void {
    const set = this.socketsByPlanet.get(planetId);
    if (!set?.size) return;
    const raw = JSON.stringify(msg);
    for (const ws of set) {
      safeRelaySend(ws, raw);
    }
  }

  closeAll(): void {
    this.unsubFeeds?.();
    this.unsubExtraFeeds?.();
    this.unwarp();
    this.undown();
    this.ununload?.();
    for (const set of this.socketsByPlanet.values()) {
      for (const ws of set) ws.close(1012, 'server_restarting');
    }
    this.socketsByPlanet.clear();
    this.wss.close();
  }
}

export function subscribeRemotePlanetStream(opts: {
  readonly internalUrl: string;
  readonly planetId: string;
  readonly env: InternalAuthEnv;
  readonly subscriber: PlanetSubscriber;
  readonly onSimFeeds: (tick: number, inputs: readonly SimInputFeedItemV1[], decisions: readonly AgentDecisionFeedItemV1[]) => void;
  readonly onWarp: (k: number) => void;
  readonly onDown: () => void;
  readonly log?: Logger;
}): () => void {
  const wsUrl = `${opts.internalUrl.replace(/^http/i, 'ws')}${INTERNAL_WS_PATH}?planetId=${encodeURIComponent(opts.planetId)}`;
  const ws = new WebSocket(wsUrl, { headers: internalAuthHeaders(opts.env) });
  let closedByLocal = false;
  let notifiedDown = false;
  const fireDown = () => {
    if (notifiedDown) return;
    notifiedDown = true;
    opts.onDown();
  };

  ws.on('message', (data) => {
    try {
      const text = typeof data === 'string' ? data : Buffer.isBuffer(data) ? data.toString('utf8') : Buffer.from(data as ArrayBuffer).toString('utf8');
      const msg = JSON.parse(text) as RelayWireMsg;
      if (msg.t === 'delta') {
        opts.subscriber.onDelta?.({
          fromTick: msg.fromTick,
          toTick: msg.toTick,
          diff: new Uint8Array(Buffer.from(msg.diffB64, 'base64')),
          events: msg.events,
        });
      } else if (msg.t === 'event') {
        opts.subscriber.onEvent?.(msg.events);
      } else if (msg.t === 'sim.feeds') {
        opts.onSimFeeds(msg.tick, msg.inputs, msg.decisions);
      } else if (msg.t === 'warp') {
        opts.onWarp(msg.k);
      } else if (msg.t === 'resync') {
        opts.subscriber.onResync?.();
      } else if (msg.t === 'planet_down') {
        closedByLocal = true;
        fireDown();
      }
    } catch (e) {
      opts.log?.debug({ planetId: opts.planetId, err: e instanceof Error ? e.message : String(e) }, 'cluster relay parse error');
    }
  });

  ws.on('close', () => {
    if (!closedByLocal) fireDown();
  });

  ws.on('error', (e) => {
    opts.log?.debug({ planetId: opts.planetId, err: e.message }, 'cluster relay ws error');
  });

  return () => {
    closedByLocal = true;
    notifiedDown = true;
    try {
      ws.close();
    } catch {
      // ignore
    }
  };
}

export function encodeWarpFrame(k: number): Uint8Array | string {
  return encodeWire({ v: 1, t: 'event', tick: 0, d: { kind: 'dev.warp', severity: 'info', atTick: 0, colonyIds: [], data: { k } } });
}

export function forwardRelayEvents(events: readonly SimEvent[], send: (frame: string | Uint8Array, tick: number) => void): void {
  for (const e of events) {
    if (hasEventKind(e.kind)) send(encodeWire({ v: 1, t: 'event', tick: e.atTick, d: e }), e.atTick);
  }
}
