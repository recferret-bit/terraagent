import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { decodeWire, newId, Welcome } from '@terra/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyPostSnapshotConnectionJoin } from '../../src/ws/parts/connection-helpers';
import { PlanetRooms, type RoomMember } from '../../src/ws/rooms';
import WebSocket from 'ws';
import { createApp } from '../../src/app';
import { devPlanetIds } from '../../src/game/dev-planets';
import { GamePlanets } from '../../src/game/game-planets.service';
import { SimHistoryService } from '../../src/game/persistence/sim-history.service';
import { LiveStatsTelemetry } from '../../src/ws/live-stats-telemetry';
import type { AppEnv } from '../../src/core/tokens';

const PLANET = devPlanetIds(1, 1)[0]!;
let app: INestApplication | undefined;
const sockets: WebSocket[] = [];

async function boot(extra: Record<string, string> = {}) {
  const created = await createApp({ source: { NODE_ENV: 'test', SIM_THREADS: '1', GAME_DEV_PLANETS: '1', ...extra } });
  await created.app.listen(0, '127.0.0.1');
  app = created.app;
  const port = new URL((await created.app.getUrl()).replace('[::1]', '127.0.0.1')).port;
  return { app: created.app, url: `ws://127.0.0.1:${port}/ws` };
}

class Client {
  readonly frames: unknown[] = [];
  closed: Promise<{ code: number; reason: string }>;
  private waiters: (() => void)[] = [];
  constructor(readonly ws: WebSocket) {
    sockets.push(ws);
    ws.on('message', (data, isBinary) => {
      const buf = data as Buffer;
      this.frames.push(decodeWire(isBinary ? buf : buf.toString('utf8')));
      this.waiters.splice(0).forEach((w) => w());
    });
    this.closed = new Promise((res) => ws.on('close', (code, reason) => res({ code, reason: reason.toString() })));
  }
  static async open(url: string): Promise<Client> {
    const ws = new WebSocket(url);
    await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); });
    return new Client(ws);
  }
  send(msg: object) { this.ws.send(JSON.stringify({ v: 1, ...msg })); }
  hello(name = 'spec') { this.send({ t: 'hello', d: { accessToken: `dev:${name}`, proto: [1], client: { app: 'game', version: 't' } } }); }
  async next(t: string, timeoutMs = 5000): Promise<{ t: string; d: Record<string, unknown> }> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const i = this.frames.findIndex((f) => (f as { t: string }).t === t);
      if (i >= 0) return this.frames.splice(i, 1)[0] as { t: string; d: Record<string, unknown> };
      const left = deadline - Date.now();
      if (left <= 0) {
        const seen = this.frames.map((f) => (f as { t: string }).t).join(',');
        throw new Error(`Timed out waiting for WS frame "${t}" (seen: [${seen}])`);
      }
      await new Promise<void>((r) => {
        const timer = setTimeout(r, Math.min(left, 250));
        this.waiters.push(() => { clearTimeout(timer); r(); });
      });
    }
  }
}

afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  await app?.close();
  app = undefined;
});

describe('WS spectator mode & live sim.input / sim.decision broadcast', () => {
  it('welcomes spectator as read-only without player spawn and rejects cmd with spectator_read_only', async () => {
    const { app: booted, url } = await boot();
    const spec1 = await Client.open(url);
    const spec2 = await Client.open(url);
    spec1.hello('viewer1');
    spec2.hello('viewer1');
    await Promise.all([spec1.next('ready'), spec2.next('ready')]);

    spec1.send({ t: 'join', d: { planetId: PLANET, mode: 'spectator' } });
    const w1 = Welcome.parse(await spec1.next('welcome'));
    expect(w1.d.mode).toBe('spectator');
    expect(w1.d.colonyId).toBeNull();

    // Multiple spectators on the same planet never kick each other (4001) and keep planet active.
    spec2.send({ t: 'join', d: { planetId: PLANET, mode: 'spectator' } });
    const w2 = Welcome.parse(await spec2.next('welcome'));
    expect(w2.d.mode).toBe('spectator');

    const cmdId = newId('cm');
    spec1.send({ t: 'cmd', id: cmdId, d: { kind: 'dev.ping', args: {} } });
    const rej = await spec1.next('cmd.reject');
    expect(rej.d).toMatchObject({ id: cmdId, code: 'spectator_read_only' });

    const history = booted.get(SimHistoryService);
    history.recordExternalInput({
      planetId: PLANET, sectorId: 'sec_0_0', colonyId: 'col_6', colonyIndex: 6, actorId: 'bot:col_6',
      isBot: true, source: 'bot', commandId: 'cm_bot_99', kind: 'enqueueTask', args: { lane: 'units' },
      status: 'applied', rejectCode: null, rejectDetail: null, atTick: 3, createdAtMs: Date.now(),
    });
    const push = await spec1.next('sim.input');
    expect((push.d.items as Array<{ commandId: string }>)[0]!.commandId).toBe('cm_bot_99');

    const gp = booted.get(GamePlanets);
    expect(gp.modeOf(PLANET)).toBe('active');
    spec1.ws.close();
    spec2.ws.close();
    await Promise.all([spec1.closed, spec2.closed]);
    await vi.waitFor(() => expect(gp.modeOf(PLANET)).toBe('coarse'));
  });

  it('allows spectator post-snapshot join even when the requested sector has 0 free seats', () => {
    const fakeAntiCheat = {
      recordRejection: vi.fn(),
      index: {
        getPlanet: () => ({ status: 'RUNNING', hasMultiSectorGrid: true, knownSectorIds: new Set(['sec_0_0']), capacity: 4 }),
        getSectorSpace: () => ({ sectorId: 'sec_0_0', kind: 'land', freeSeats: 0 }),
      },
    } as never;
    const playVerdict = verifyPostSnapshotConnectionJoin({
      antiCheat: fakeAntiCheat, planetId: 'pl_full', colonyId: null, colonyIndex: undefined,
      requestedSectorId: 'sec_0_0', dev: true, isScenarioPlanet: false, mode: 'play',
    });
    expect(playVerdict).toEqual({ ok: false, reason: 'sector_full' });

    const specVerdict = verifyPostSnapshotConnectionJoin({
      antiCheat: fakeAntiCheat, planetId: 'pl_full', colonyId: null, colonyIndex: undefined,
      requestedSectorId: 'sec_0_0', dev: true, isScenarioPlanet: false, mode: 'spectator',
    });
    expect(specVerdict.ok).toBe(true);
  });
});

describe('Cluster relay eviction, body limits & telemetry bot counting', () => {
  it('evicts dead remote rooms when relay drops so reconnecting sockets re-open clean streams', () => {
    const fakePlanets = {
      subscribe: vi.fn(() => () => undefined),
    } as never;
    const rooms = new PlanetRooms(fakePlanets);
    let downCount = 0;
    const fakeMember: RoomMember = {
      welcomeTick: 1,
      send: vi.fn(),
      bufferedAmount: 0,
      paused: false,
      resync: vi.fn(),
    };
    rooms.join('pl_remote_evict', fakeMember, {
      internalUrl: 'http://127.0.0.1:1',
      env: {},
      onSimFeeds: () => undefined,
      onWarp: () => undefined,
      onDown: () => {
        downCount += 1;
      },
    });
    expect(rooms.size('pl_remote_evict')).toBe(1);
    return vi.waitFor(() => {
      expect(downCount).toBe(1);
      expect(rooms.size('pl_remote_evict')).toBe(0);
    }, { timeout: 3000 });
  });

  it('allows >100KB internal cluster snapshot POSTs while capping public POSTs at 1MB', async () => {
    const { url } = await boot({ TA_INTERNAL_SECRET: 'secret-123' });
    const httpBase = url.replace(/^ws:/, 'http:').replace(/\/ws$/, '');

    const internalRes = await fetch(`${httpBase}/v1/internal/sim/planets/pl_big/load-new`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-terra-internal-token': 'secret-123' },
      body: JSON.stringify({ snapshotBase64: Buffer.alloc(180_000, 1).toString('base64') }),
    });
    expect(internalRes.status).not.toBe(403);
    expect(internalRes.status).not.toBe(413);

    const oversizedPublic = await fetch(`${httpBase}/v1/dev/planets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pad: 'x'.repeat(1_200_000) }),
    });
    expect(oversizedPublic.status).toBe(413);
  });

  it('counts DB colonies marked isBot or bot: alongside ai: in LiveStatsTelemetry', async () => {
    const fakeGateway = { onlinePlayersByPlanet: () => new Map(), onlinePlayerCount: () => 0 } as never;
    const fakePrisma = {
      planet: { findMany: async () => [{ id: 'pl_d', type: 'desert', state: 'RUNNING', lifecycle: 'ACTIVE' }] },
      colony: {
        findMany: async () => [
          { id: 'col_a', planetId: 'pl_d', playerId: 'ai:trader', isBot: true, name: 'Bot A', foundingSectorId: 'sec_0_0', colonyIndex: 0 },
          { id: 'col_b', planetId: 'pl_d', playerId: 'bot:warlord', isBot: false, name: 'Bot B', foundingSectorId: 'sec_1_0', colonyIndex: 1 },
          { id: 'col_c', planetId: 'pl_d', playerId: 'player_human', isBot: true, name: 'Bot C', foundingSectorId: 'sec_0_1', colonyIndex: 2 },
          { id: 'col_h', planetId: 'pl_d', playerId: 'player_human_real', isBot: false, name: 'Human', foundingSectorId: 'sec_1_1', colonyIndex: 3 },
        ],
      },
      sectorReservation: { findMany: async () => [] },
      marketStall: { findMany: async () => [] },
      tradeApiKey: { findMany: async () => [] },
    } as never;
    const telemetry = new LiveStatsTelemetry(
      fakeGateway,
      fakePrisma,
      { DATABASE_URL: 'postgres://localhost/test', NEAR_MODE: 'mock' } as unknown as AppEnv,
    );
    const counts = await telemetry.getPlanetLiveCounts('pl_d', 'desert');
    expect(counts.botColonies).toBe(3);
    expect(counts.playerColonies).toBe(1);
    expect(counts.livingColonies).toBe(4);
  });
});
