import 'reflect-metadata';
import { request as httpRequest } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { CANONICAL_PLANETS, decodeWire, newId, Welcome } from '@terra/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyPostSnapshotConnectionJoin } from '../../src/ws/parts/connection-helpers';
import { PlanetRooms, type RoomMember } from '../../src/ws/rooms';
import WebSocket from 'ws';
import { createApp } from '../../src/app';
import { devPlanetIds } from '../../src/game/dev-planets';
import { GamePlanets } from '../../src/game/game-planets.service';
import { PlanetLedgerService } from '../../src/game/ledger/planet-ledger.service';
import { SimHistoryService } from '../../src/game/persistence/sim-history.service';
import { HomeRepository } from '../../src/core/home/home.repository';
import { isLocalRequestHeaders, isSpectatorEnvAllowed } from '../../src/core/local-host-guard';
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
  static async open(url: string, headers?: Record<string, string>): Promise<Client> {
    const ws = new WebSocket(url, headers ? { headers } : undefined);
    await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); });
    return new Client(ws);
  }
  send(msg: object) { this.ws.send(JSON.stringify({ v: 1, ...msg })); }
  hello(name = 'spec') { this.send({ t: 'hello', d: { accessToken: `dev:${name}`, proto: [2], client: { app: 'game', version: 't' } } }); }
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

describe('Server spectator provisioning, reset & local-only guards', () => {
  it('provisions live bot-only server spectator planet via POST /v1/dev/spectator and wipes from scratch on reset=true', async () => {
    const { url } = await boot();
    const httpBase = url.replace(/^ws:/, 'http:').replace(/\/ws$/, '');

    const createRes = await fetch(`${httpBase}/v1/dev/spectator`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ planetType: 'oceanForest', botCount: 2 }),
    });
    expect(createRes.status).toBe(200);
    const created = (await createRes.json()) as { planetId: string; botCount: number; created: boolean; reset: boolean };
    expect(created).toMatchObject({ planetId: 'pl_spec_ocean_2', botCount: 2, created: true, reset: false });

    const spec = await Client.open(url);
    spec.hello('spec_srv');
    await spec.next('ready');
    spec.send({ t: 'join', d: { planetId: created.planetId, mode: 'spectator' } });
    const w1 = Welcome.parse(await spec.next('welcome'));
    expect(w1.d.mode).toBe('spectator');
    expect(w1.d.planet.id).toBe('pl_spec_ocean_2');

    // Wait for bots to emit live sim.input frames on the server spectator planet
    const botInput = await spec.next('sim.input', 10_000);
    expect((botInput.d.items as Array<{ isBot: boolean }>)[0]?.isBot).toBe(true);

    // Re-requesting without reset preserves the running planet
    const resumeRes = await fetch(`${httpBase}/v1/dev/spectator`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ planetType: 'oceanForest', botCount: 2 }),
    });
    expect(resumeRes.status).toBe(200);
    const resumed = (await resumeRes.json()) as { planetId: string; tick: number; created: boolean; reset: boolean };
    expect(resumed.planetId).toBe('pl_spec_ocean_2');
    expect(resumed.created).toBe(false);
    expect(resumed.reset).toBe(false);
    expect(resumed.tick).toBeGreaterThan(0);

    // Resetting wipes bots + history, evicts open spectator sockets with 4012, and restarts from scratch
    const resetRes = await fetch(`${httpBase}/v1/dev/spectator`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ planetType: 'oceanForest', botCount: 2, reset: true }),
    });
    expect(resetRes.status).toBe(200);
    const resetBody = (await resetRes.json()) as { planetId: string; tick: number; created: boolean; reset: boolean };
    expect(resetBody).toMatchObject({ planetId: 'pl_spec_ocean_2', tick: 0, created: true, reset: true });
    const closedInfo = await spec.closed;
    expect(closedInfo.code).toBe(4012);

    // Canonical planets cannot be wiped via reset=true
    const badCanonical = await fetch(`${httpBase}/v1/dev/spectator`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ planetId: CANONICAL_PLANETS.temperate.id, reset: true }),
    });
    expect(badCanonical.status).toBe(403);

    // Non-canonical planets with active human colonies cannot be wiped via spectator reset
    const homes = app!.get(HomeRepository);
    await homes.createColony({ playerId: 'pr_human_1', planetId: PLANET, colonyIndex: 0, name: 'Human Base', spawnQ: 0, spawnR: 0 });
    const badHuman = await fetch(`${httpBase}/v1/dev/spectator`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ planetId: PLANET, reset: true }),
    });
    expect(badHuman.status).toBe(403);
  });
});

describe('Server scenario spectator & ?join=<planetId> non-mutating ensure', () => {
  it('drives live bots on scenario spectator worlds (w18, w01) and keeps ?join=<planetId> non-mutating', async () => {
    const { url } = await boot();
    const httpBase = url.replace(/^ws:/, 'http:').replace(/\/ws$/, '');

    // Deterministic server scenario spectator (?spectator=1&host=server&scenario=w18 & w01) creates active bots, emits live sim.input, resumes, and resets cleanly
    const scCreate = await fetch(`${httpBase}/v1/dev/spectator`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scenario: 'w18' }),
    });
    expect(scCreate.status).toBe(200);
    const sc1 = (await scCreate.json()) as { planetId: string; tick: number; botCount: number; created: boolean; reset: boolean };
    expect(sc1).toMatchObject({ planetId: 'pl_spec_sc_w18', created: true, reset: false });
    expect(sc1.botCount).toBe(5);

    const scSpecWs = await Client.open(url);
    scSpecWs.hello('sc_w18_viewer');
    await scSpecWs.next('ready');
    scSpecWs.send({ t: 'join', d: { planetId: 'pl_spec_sc_w18', mode: 'spectator' } });
    await scSpecWs.next('welcome');
    const scBotInput = await scSpecWs.next('sim.input', 10_000);
    expect((scBotInput.d.items as Array<{ isBot: boolean }>)[0]?.isBot).toBe(true);
    scSpecWs.ws.close();

    const w01Create = await fetch(`${httpBase}/v1/dev/spectator`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scenario: 'w01' }),
    });
    expect(w01Create.status).toBe(200);
    expect(await w01Create.json()).toMatchObject({ planetId: 'pl_spec_sc_w01', botCount: 1, created: true });
    const w01Ws = await Client.open(url);
    w01Ws.hello('sc_w01_viewer');
    await w01Ws.next('ready');
    w01Ws.send({ t: 'join', d: { planetId: 'pl_spec_sc_w01', mode: 'spectator' } });
    await w01Ws.next('welcome');
    const w01BotInput = await w01Ws.next('sim.input', 10_000);
    expect((w01BotInput.d.items as Array<{ isBot: boolean }>)[0]?.isBot).toBe(true);
    w01Ws.ws.close();

    const scResume = await fetch(`${httpBase}/v1/dev/spectator`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scenario: 'w18' }),
    });
    expect(scResume.status).toBe(200);
    expect(await scResume.json()).toMatchObject({ planetId: 'pl_spec_sc_w18', created: false, reset: false });

    const scReset = await fetch(`${httpBase}/v1/dev/spectator`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scenario: 'w18', reset: true }),
    });
    expect(scReset.status).toBe(200);
    expect(await scReset.json()).toMatchObject({ planetId: 'pl_spec_sc_w18', tick: sc1.tick, created: true, reset: true });

    // Non-mutating ensure for ?spectator=1&join=<planetId> on existing scenario planet (activeHumans > 0) & non-fabrication on missing planetId
    const humanW18Res = await fetch(`${httpBase}/v1/dev/scenarios/w18`, { method: 'POST' });
    expect(humanW18Res.status).toBe(200);
    const { planetId: humanW18Id } = (await humanW18Res.json()) as { planetId: string };
    const joinEnsureRes = await fetch(`${httpBase}/v1/dev/spectator`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ planetId: humanW18Id }),
    });
    expect(joinEnsureRes.status).toBe(200);
    expect(await joinEnsureRes.json()).toMatchObject({ planetId: humanW18Id, botCount: 5, created: false, reset: false });

    const missingEnsureRes = await fetch(`${httpBase}/v1/dev/spectator`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ planetId: 'pl_nonexistent_target' }),
    });
    expect(missingEnsureRes.status).toBe(200);
    expect(await missingEnsureRes.json()).toMatchObject({ planetId: 'pl_nonexistent_target', botCount: 0, created: false, reset: false });
    expect(app!.get(GamePlanets).isLoaded('pl_nonexistent_target')).toBe(false);
  }, 30_000);
});

describe('Server spectator ?join=<planetId>&reset=1 preservation & ledger reconciliation', () => {
  it('preserves scenario, biome, botCount, and seed when resetting via explicit ?join=<planetId>&reset=1 and reconciles w18 ledger', async () => {
    const { url } = await boot();
    const httpBase = url.replace(/^ws:/, 'http:').replace(/\/ws$/, '');

    // 1. Seed a 4-bot custom desert spectator world, then reset by planetId alone (?spectator=1&join=<planetId>&reset=1)
    const customInit = await fetch(`${httpBase}/v1/dev/spectator`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ planetType: 'dune', botCount: 4, seed: 'join-keep-seed' }),
    });
    expect(customInit.status).toBe(200);
    const customBody = (await customInit.json()) as { planetId: string; botCount: number };
    expect(customBody.botCount).toBe(4);

    const customResetByJoin = await fetch(`${httpBase}/v1/dev/spectator`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ planetId: customBody.planetId, reset: true }),
    });
    expect(customResetByJoin.status).toBe(200);
    expect(await customResetByJoin.json()).toMatchObject({
      planetId: customBody.planetId,
      tick: 0,
      botCount: 4,
      created: true,
      reset: true,
    });
    const fullAfterReset = await app!.get(GamePlanets).fullState(customBody.planetId);
    expect(fullAfterReset.planetType).toBe('desert');

    // 2. Seed w18 scenario spectator world, verify clean PlanetLedgerService opening balances, and reset by planetId alone
    await fetch(`${httpBase}/v1/dev/spectator`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scenario: 'w18' }),
    });
    const scJoinReset = await fetch(`${httpBase}/v1/dev/spectator`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ planetId: 'pl_spec_sc_w18', reset: true }),
    });
    expect(scJoinReset.status).toBe(200);
    expect(await scJoinReset.json()).toMatchObject({
      planetId: 'pl_spec_sc_w18',
      botCount: 5,
      created: true,
      reset: true,
    });
    await vi.waitFor(() => expect(app!.get(PlanetLedgerService).journalOf('pl_spec_sc_w18')).not.toBeNull());
    expect(app!.get(PlanetLedgerService).unwrittenRows('pl_spec_sc_w18')).toBe(0);
  }, 30_000);
});

describe('Server spectator non-local host rejection', () => {
  it('blocks spoofed Host: localhost from non-loopback IPs, X-Forwarded-For, cross-origin, and staging APP_ENV', () => {
    expect(isLocalRequestHeaders({ host: 'localhost:4000' }, '127.0.0.1')).toBe(true);
    expect(isLocalRequestHeaders({ host: '[::1]:5173' }, '::1')).toBe(true);
    expect(isLocalRequestHeaders({ host: '::1' }, '::1')).toBe(true);

    // Spoofed Host: localhost from remote IP must fail closed
    expect(isLocalRequestHeaders({ host: 'localhost:4000' }, '203.0.113.42')).toBe(false);
    expect(isLocalRequestHeaders({ host: '127.0.0.1:4000' }, '::ffff:192.168.1.50')).toBe(false);
    // Reverse proxy forwarding remote client IP
    expect(isLocalRequestHeaders({ host: '127.0.0.1:4000', 'x-forwarded-for': '203.0.113.42' }, '127.0.0.1')).toBe(false);
    // Chained X-Forwarded-Host
    expect(isLocalRequestHeaders({ host: 'localhost', 'x-forwarded-host': 'localhost, play.terraagent.fun' }, '127.0.0.1')).toBe(false);
    // Non-local Origin
    expect(isLocalRequestHeaders({ host: '127.0.0.1:4000', origin: 'https://play.terraagent.fun' }, '127.0.0.1')).toBe(false);
    expect(isLocalRequestHeaders({ host: '127.0.0.1:4000', origin: 'http://127.0.0.1:5173' }, '127.0.0.1')).toBe(true);

    expect(isSpectatorEnvAllowed({ NODE_ENV: 'development', APP_ENV: 'staging' }, { host: '127.0.0.1:4000' }, '127.0.0.1')).toBe(false);
    expect(isSpectatorEnvAllowed({ NODE_ENV: 'production' }, { host: '127.0.0.1:4000' }, '127.0.0.1')).toBe(false);
    expect(isSpectatorEnvAllowed({ NODE_ENV: 'development', APP_ENV: 'local' }, { host: '127.0.0.1:4000' }, '127.0.0.1')).toBe(true);
  });

  it('rejects WS spectator join and HTTP /v1/dev/spectator on non-local Host / X-Forwarded-Host / X-Forwarded-For / Origin headers', async () => {
    const { url } = await boot();
    const httpBase = url.replace(/^ws:/, 'http:').replace(/\/ws$/, '');

    const forwardedHttp = await fetch(`${httpBase}/v1/dev/spectator`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-host': 'play.terraagent.fun' },
      body: JSON.stringify({}),
    });
    expect(forwardedHttp.status).toBe(404);

    const xffHttp = await fetch(`${httpBase}/v1/dev/spectator`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.42' },
      body: JSON.stringify({}),
    });
    expect(xffHttp.status).toBe(404);

    const remoteOriginHttp = await fetch(`${httpBase}/v1/dev/spectator`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://play.terraagent.fun' },
      body: JSON.stringify({}),
    });
    expect(remoteOriginHttp.status).toBe(404);

    const rawHostStatus = await new Promise<number>((resolve, reject) => {
      const parsed = new URL(`${httpBase}/v1/dev/spectator`);
      const req = httpRequest(
        {
          hostname: parsed.hostname,
          port: parsed.port,
          path: parsed.pathname,
          method: 'POST',
          headers: { 'content-type': 'application/json', host: 'play.terraagent.fun', 'content-length': 2 },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode ?? 0));
        },
      );
      req.on('error', reject);
      req.end('{}');
    });
    expect(rawHostStatus).toBe(404);

    const remoteWs = await Client.open(url, { Host: 'play.terraagent.fun' });
    remoteWs.hello('viewer_remote');
    await remoteWs.next('ready');
    remoteWs.send({ t: 'join', d: { planetId: PLANET, mode: 'spectator' } });
    const bye = await remoteWs.next('bye');
    expect(bye.d).toMatchObject({ code: 4003, reason: 'spectator_local_only' });
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
